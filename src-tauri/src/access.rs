//! 허용 경로 목록(D13). 파일 커맨드는 사용자가 다이얼로그로 고르거나 창에 드롭한 경로와
//! 앱이 만든 폴더(이 실행의 병합 임시 세션 폴더, TIFF 변환 결과 폴더) 안의 경로만 받는다.
//! 내보내기는 폴더 다이얼로그에서 고른 폴더 바로 안에 새 파일만 만든다(있는 파일을 덮지 않는다).
//!
//! 모든 경로는 `canonicalize`한 뒤 비교한다. 심볼릭 링크와 `..`이 풀리므로
//! 폴더 밖을 가리키는 링크는 폴더 밖 경로로 판정된다.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use pdf_core::SaveError;

use crate::error::{CommandError, read_error, write_error};

pub(crate) const PDF_EXTENSION: &str = "pdf";
const TIF_EXTENSION: &str = "tif";
const TIFF_EXTENSION: &str = "tiff";
const TIFF_EXTENSIONS: [&str; 2] = [TIF_EXTENSION, TIFF_EXTENSION];
/// 파일 추가(`open_files`)에서 받는 확장자
pub(crate) const OPENABLE_EXTENSIONS: [&str; 3] = [PDF_EXTENSION, TIF_EXTENSION, TIFF_EXTENSION];

/// 병합 임시 결과 이름 앞부분
const TEMP_OUTPUT_PREFIX: &str = "merged-";

/// 세션 폴더 이름 앞부분. 뒤에 프로세스 ID와 시작 시각(나노초)이 붙는다.
const SESSION_DIRECTORY_PREFIX: &str = "session-";
/// 이보다 오래 손대지 않은 다른 세션 폴더는 앱 시작 때 지운다(종료 정리를 못 한 실행의 흔적).
pub(crate) const STALE_SESSION_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// 내보낼 이름이 이미 있을 때 붙여 볼 번호의 끝(`이름 (2).pdf` ~ `이름 (999).pdf`). 다 차면 쓰지 않는다.
const MAX_EXPORT_NAME_NUMBER: u32 = 999;
/// 같은 이름이 있을 때 둘째부터 붙이는 번호의 시작
const FIRST_DUPLICATE_NUMBER: u32 = 2;

/// 앱이 만들고 관리하는 폴더. 모두 canonical 경로다.
#[derive(Debug, Clone)]
pub(crate) struct AppDirectories {
    /// 모든 실행의 세션 폴더를 담는 앱 임시 폴더
    temp_root: PathBuf,
    /// 이 실행의 세션 폴더. 병합 미리보기 결과(`output: temp`)는 여기에만 쓴다.
    /// 여러 실행이 서로의 결과를 지우지 않도록 실행마다 나눈다.
    pub(crate) temp: PathBuf,
    /// TIFF 변환 결과 PDF를 두는 앱 캐시 하위 폴더
    pub(crate) converted: PathBuf,
}

impl AppDirectories {
    /// `temp_root` 아래에 이 실행의 세션 폴더를 만들고, 폴더를 모두 canonical 경로로 둔다
    /// (macOS는 `/var` → `/private/var`).
    pub(crate) fn create(temp_root: &Path, converted: &Path) -> io::Result<Self> {
        let started_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let session = temp_root.join(format!(
            "{SESSION_DIRECTORY_PREFIX}{}-{started_nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&session)?;
        fs::create_dir_all(converted)?;
        Ok(Self {
            temp_root: temp_root.canonicalize()?,
            temp: session.canonicalize()?,
            converted: converted.canonicalize()?,
        })
    }

    /// 이 실행이 아닌 세션 폴더 중 `now` 기준 `max_age`보다 오래 손대지 않은 것을 지운다.
    /// 최근에 쓰인 다른 세션 폴더는 다른 실행이 쓰는 중일 수 있어 남긴다.
    /// 항목 하나가 실패해도 나머지는 계속 지운다. 다른 실행이 동시에 지운 항목(`NotFound`)은 무시하고,
    /// 그 밖의 오류는 첫 번째만 돌려준다.
    pub(crate) fn remove_stale_sessions(
        &self,
        max_age: Duration,
        now: SystemTime,
    ) -> io::Result<()> {
        let mut first_error = None;
        for entry in fs::read_dir(&self.temp_root)? {
            let outcome = entry.and_then(|entry| self.remove_if_stale(&entry, max_age, now));
            if let Err(error) = outcome
                && error.kind() != io::ErrorKind::NotFound
                && first_error.is_none()
            {
                first_error = Some(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    fn remove_if_stale(
        &self,
        entry: &fs::DirEntry,
        max_age: Duration,
        now: SystemTime,
    ) -> io::Result<()> {
        let path = entry.path();
        let is_other_session = entry
            .file_name()
            .to_string_lossy()
            .starts_with(SESSION_DIRECTORY_PREFIX)
            && path != self.temp
            && entry.file_type()?.is_dir();
        if !is_other_session {
            return Ok(());
        }
        let modified = entry.metadata()?.modified()?;
        if now.duration_since(modified).is_ok_and(|age| age > max_age) {
            fs::remove_dir_all(&path)?;
        }
        Ok(())
    }

    /// 이 실행의 세션 폴더를 지운다(앱 종료 때).
    pub(crate) fn remove_session(&self) -> io::Result<()> {
        fs::remove_dir_all(&self.temp)
    }
}

pub(crate) struct PathAccess {
    directories: AppDirectories,
    /// 열기 다이얼로그에서 고르거나 창에 드롭한 파일(canonical). 읽기만 허용한다.
    opened: Mutex<HashSet<PathBuf>>,
    /// 저장 다이얼로그에서 고른 파일(정규화). 쓰기만 허용한다.
    save_targets: Mutex<HashSet<PathBuf>>,
    /// 폴더 다이얼로그에서 고른 내보내기 폴더(canonical). 그 바로 안에 새 PDF만 만든다.
    save_directories: Mutex<HashSet<PathBuf>>,
    /// 같은 프로세스 안에서 임시 결과 이름이 겹치지 않게 하는 일련번호
    sequence: AtomicU64,
}

impl PathAccess {
    pub(crate) fn new(directories: AppDirectories) -> Self {
        Self {
            directories,
            opened: Mutex::default(),
            save_targets: Mutex::default(),
            save_directories: Mutex::default(),
            sequence: AtomicU64::new(0),
        }
    }

    pub(crate) fn directories(&self) -> &AppDirectories {
        &self.directories
    }

    /// 열기 다이얼로그에서 고른 파일을 기록하고 canonical 경로를 돌려준다.
    pub(crate) fn allow_opened(&self, path: &Path) -> Result<PathBuf, CommandError> {
        let canonical = path
            .canonicalize()
            .map_err(|source| read_error(path, source))?;
        lock(&self.opened).insert(canonical.clone());
        Ok(canonical)
    }

    /// 창에 드롭한 파일 중 열 수 있는 것(있는 파일, 파일 추가 확장자)만 열기 목록에 기록한다.
    /// 폴더·없는 경로·다른 확장자는 건너뛴다. 드롭 이벤트가 웹뷰에 가기 전에 부른다.
    pub(crate) fn allow_dropped(&self, paths: &[PathBuf]) {
        let openable: Vec<PathBuf> = paths
            .iter()
            .filter_map(|path| {
                let canonical = path.canonicalize().ok()?;
                (canonical.is_file() && has_extension(&canonical, &OPENABLE_EXTENSIONS))
                    .then_some(canonical)
            })
            .collect();
        lock(&self.opened).extend(openable);
    }

    /// 저장 다이얼로그에서 고른 경로를 기록하고 정규화한 경로를 돌려준다.
    pub(crate) fn allow_save_target(&self, path: &Path) -> Result<PathBuf, CommandError> {
        let normalized = normalize_save_target(path)?;
        lock(&self.save_targets).insert(normalized.clone());
        Ok(normalized)
    }

    /// 폴더 다이얼로그에서 고른 내보내기 폴더를 기록하고 canonical 경로를 돌려준다.
    pub(crate) fn allow_save_directory(&self, path: &Path) -> Result<PathBuf, CommandError> {
        let canonical = canonical_directory(path)?;
        lock(&self.save_directories).insert(canonical.clone());
        Ok(canonical)
    }

    /// 내보낼 새 PDF 경로: 고른 내보내기 폴더 바로 안의 `file_name`. 그 이름의 파일(또는 링크)이 이미 있으면
    /// 덮어쓰지 않고 `이름 (2).pdf`, `이름 (3).pdf`…처럼 비어 있는 이름을 고른다. `file_name`은 경로 구분자·
    /// `..` 없는 이름 하나여야 하고 확장자가 `pdf`여야 한다.
    pub(crate) fn export_target(
        &self,
        directory: &Path,
        file_name: &str,
    ) -> Result<PathBuf, CommandError> {
        let canonical = canonical_directory(directory)?;
        let name = Path::new(file_name);
        let is_plain_name = matches!(
            name.components().collect::<Vec<_>>().as_slice(),
            [Component::Normal(_)]
        );
        if !lock(&self.save_directories).contains(&canonical) || !is_plain_name {
            return Err(CommandError::PathNotAllowed {
                path: canonical.join(name),
            });
        }
        ensure_extension(name, &[PDF_EXTENSION])?;
        let stem = name
            .file_stem()
            .unwrap_or(name.as_os_str())
            .to_string_lossy();
        let extension = name.extension().unwrap_or_default().to_string_lossy();
        std::iter::once(file_name.to_owned())
            .chain(
                (FIRST_DUPLICATE_NUMBER..=MAX_EXPORT_NAME_NUMBER)
                    .map(|number| format!("{stem} ({number}).{extension}")),
            )
            .map(|candidate| canonical.join(candidate))
            .find(|candidate| fs::symlink_metadata(candidate).is_err())
            .ok_or_else(|| {
                write_error(
                    &canonical.join(name),
                    io::Error::from(io::ErrorKind::AlreadyExists),
                )
            })
    }

    /// 읽어도 되는 파일의 canonical 경로. 열기 다이얼로그에서 고른 파일이거나 앱 폴더 안이어야 하고,
    /// 확장자가 `extensions` 중 하나여야 한다.
    pub(crate) fn readable(
        &self,
        path: &Path,
        extensions: &[&str],
    ) -> Result<PathBuf, CommandError> {
        let canonical = path
            .canonicalize()
            .map_err(|source| read_error(path, source))?;
        let is_allowed = lock(&self.opened).contains(&canonical)
            || canonical.starts_with(&self.directories.temp)
            || canonical.starts_with(&self.directories.converted);
        if !is_allowed {
            return Err(CommandError::PathNotAllowed { path: canonical });
        }
        ensure_extension(&canonical, extensions)?;
        Ok(canonical)
    }

    /// 써도 되는 사용자 경로: 저장 다이얼로그에서 고른 PDF 경로만.
    pub(crate) fn save_target(&self, path: &Path) -> Result<PathBuf, CommandError> {
        let normalized = normalize_save_target(path)?;
        if !lock(&self.save_targets).contains(&normalized) {
            return Err(CommandError::PathNotAllowed { path: normalized });
        }
        ensure_extension(&normalized, &[PDF_EXTENSION])?;
        Ok(normalized)
    }

    /// 이 실행의 세션 폴더 안에 있는 파일의 canonical 경로. 폴더 자체와 폴더 밖(다른 세션 포함)은 거부한다.
    pub(crate) fn temp_file(&self, path: &Path) -> Result<PathBuf, CommandError> {
        let canonical = path
            .canonicalize()
            .map_err(|source| read_error(path, source))?;
        if canonical == self.directories.temp
            || !canonical.starts_with(&self.directories.temp)
            || !canonical.is_file()
        {
            return Err(CommandError::PathNotAllowed { path: canonical });
        }
        Ok(canonical)
    }

    /// 세션 폴더 안의 새 병합 결과 경로.
    /// `{prefix}{프로세스 ID}-{나노초}-{일련번호}.pdf`라 다른 실행과도 겹치지 않는다.
    /// 다른 실행이 오래된 세션으로 보고 폴더를 지웠을 수 있어 폴더를 다시 만든다.
    pub(crate) fn new_temp_output(&self) -> Result<PathBuf, CommandError> {
        let temp = &self.directories.temp;
        fs::create_dir_all(temp).map_err(|source| write_error(temp, source))?;
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let name = format!(
            "{TEMP_OUTPUT_PREFIX}{}-{nanos}-{sequence}.{PDF_EXTENSION}",
            std::process::id()
        );
        Ok(temp.join(name))
    }

    /// 열기 다이얼로그에서 고른 파일(사용자 원본)인지. `path`는 정규화된 경로여야 한다.
    pub(crate) fn is_opened(&self, path: &Path) -> bool {
        lock(&self.opened).contains(path)
    }

    /// 세션 폴더 안의 결과를 모두 지운다. 폴더는 비운 채로 남긴다.
    pub(crate) fn cleanup_session(&self) -> Result<(), CommandError> {
        let temp = &self.directories.temp;
        let write = |source| write_error(temp, source);
        match fs::remove_dir_all(temp) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(write(error)),
        }
        fs::create_dir_all(temp).map_err(write)
    }
}

pub(crate) fn is_tiff(path: &Path) -> bool {
    has_extension(path, &TIFF_EXTENSIONS)
}

/// 집합은 넣기·찾기만 하므로 다른 스레드가 패닉해도 내용이 깨지지 않는다. 잠금 오염은 무시한다.
fn lock(set: &Mutex<HashSet<PathBuf>>) -> MutexGuard<'_, HashSet<PathBuf>> {
    set.lock().unwrap_or_else(PoisonError::into_inner)
}

/// 있는 폴더의 canonical 경로. 없으면 출력 폴더 없음(입력 파일 탓이 아니다)이다.
fn canonical_directory(path: &Path) -> Result<PathBuf, CommandError> {
    let canonical = path.canonicalize().map_err(|source| {
        if source.kind() == io::ErrorKind::NotFound {
            CommandError::Save(SaveError::DirectoryNotFound {
                path: path.to_path_buf(),
            })
        } else {
            write_error(path, source)
        }
    })?;
    if canonical.is_dir() {
        Ok(canonical)
    } else {
        Err(CommandError::Save(SaveError::DirectoryNotFound {
            path: canonical,
        }))
    }
}

/// 저장 경로는 아직 없을 수 있다. 있으면 canonical 경로(링크를 푼 실제 파일),
/// 없으면 canonical 폴더 + 파일 이름이다.
/// 실패는 출력 쪽 에러라 `AppError.path`(실패한 입력 파일)를 채우지 않는다.
fn normalize_save_target(path: &Path) -> Result<PathBuf, CommandError> {
    if path.exists() {
        return path
            .canonicalize()
            .map_err(|source| write_error(path, source));
    }
    let not_allowed = || CommandError::PathNotAllowed {
        path: path.to_path_buf(),
    };
    let file_name = path.file_name().ok_or_else(not_allowed)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(not_allowed)?;
    let directory = parent.canonicalize().map_err(|source| {
        if source.kind() == io::ErrorKind::NotFound {
            CommandError::Save(SaveError::DirectoryNotFound {
                path: parent.to_path_buf(),
            })
        } else {
            write_error(parent, source)
        }
    })?;
    Ok(directory.join(file_name))
}

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extensions
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn ensure_extension(path: &Path, extensions: &[&str]) -> Result<(), CommandError> {
    if has_extension(path, extensions) {
        Ok(())
    } else {
        Err(CommandError::UnsupportedFileType {
            path: path.to_path_buf(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{AppError, ErrorCode};
    use crate::test_support::TestDir;

    #[test]
    fn startup_cleanup_removes_only_stale_sessions_of_other_runs() {
        let test_dir = TestDir::new("stale-sessions");
        let access = test_dir.access();
        let directories = access.directories();
        let other_session = directories.temp.with_file_name("session-other");
        fs::create_dir_all(&other_session).expect("create other session");
        fs::write(other_session.join("preview.pdf"), b"%PDF").expect("write preview");
        let unrelated = directories.temp.with_file_name("not-a-session");
        fs::create_dir_all(&unrelated).expect("create unrelated dir");

        directories
            .remove_stale_sessions(STALE_SESSION_AGE, SystemTime::now())
            .expect("cleanup now");
        assert!(
            other_session.exists(),
            "recent session of another run is kept"
        );

        let a_day_later = SystemTime::now() + STALE_SESSION_AGE + Duration::from_secs(60);
        directories
            .remove_stale_sessions(STALE_SESSION_AGE, a_day_later)
            .expect("cleanup later");
        assert!(!other_session.exists());
        assert!(directories.temp.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn user_file_is_readable_only_after_it_is_picked_in_the_open_dialog() {
        let test_dir = TestDir::new("readable-after-pick");
        let access = test_dir.access();
        let path = test_dir.copy_fixture("one-page.pdf", "contract.pdf");

        let before = access.readable(&path, &[PDF_EXTENSION]).unwrap_err();
        assert_eq!(before.code(), ErrorCode::PathNotAllowed);

        let picked = access.allow_opened(&path).expect("pick");
        assert_eq!(
            access.readable(&path, &[PDF_EXTENSION]).expect("readable"),
            picked
        );
    }

    #[test]
    fn dropped_files_are_readable_only_when_they_have_an_openable_extension() {
        let test_dir = TestDir::new("readable-after-drop");
        let access = test_dir.access();
        let pdf = test_dir.copy_fixture("one-page.pdf", "dropped.pdf");
        let text = test_dir.user("notes.txt");
        fs::write(&text, b"not a pdf").expect("write text file");

        access.allow_dropped(&[pdf.clone(), text.clone()]);

        assert_eq!(
            access
                .readable(&pdf, &OPENABLE_EXTENSIONS)
                .expect("readable"),
            pdf.canonicalize().expect("canonical")
        );
        let canonical_text = text.canonicalize().expect("canonical");
        assert!(!access.is_opened(&canonical_text));
    }

    #[test]
    fn missing_save_folder_is_not_reported_as_the_failed_input_file() {
        let test_dir = TestDir::new("missing-save-folder");
        let access = test_dir.access();
        let folder = test_dir.user("exports");
        fs::create_dir_all(&folder).expect("create save folder");
        let target = folder.join("merged.pdf");
        access.allow_save_target(&target).expect("pick save path");
        fs::remove_dir(&folder).expect("remove save folder");

        let error = AppError::from(access.save_target(&target).unwrap_err());

        assert_eq!(error.code, ErrorCode::OutputDirectoryNotFound);
        assert_eq!(error.path, None);
    }
}
