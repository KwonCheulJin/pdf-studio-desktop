//! 쪽별 OCR 결과 디스크 캐시(계획서 §6.4 「성능, 취소, 캐시」, ADR 0001 §11).
//!
//! - 키는 `(파일 SHA-256, 쪽 번호, OCR_MODEL_VERSION, OCR_RENDER_DPI)`다. 파일 내용이 같으면 경로가
//!   달라도 다시 쓰고, 모델·렌더 해상도가 바뀌면 키가 달라져 다시 읽는다.
//! - 값은 렌더 이미지 크기와 줄(픽셀 좌표)을 JSON으로 쓴 파일 하나다. 좌표 되돌리기는 읽을 때마다
//!   쪽 상자로 다시 한다.
//! - 캐시는 최선 노력이다. 읽기·쓰기·지우기가 실패해도 비교는 OCR을 다시 하거나 그대로 계속한다.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{OCR_MODEL_VERSION, OCR_RENDER_DPI, OcrLine};
use crate::output::write_atomically;

/// 캐시 폴더 용량 상한. 넘으면 마지막으로 쓰거나 읽은 지 오래된 파일부터 지운다.
///
/// 쪽 결과 하나는 글자 상자 때문에 본문이 빽빽한 A4에서 수백 KB다. 256 MiB면 스캔 계약서
/// 수백 쪽(여러 번의 비교)을 담는다.
pub const MAX_OCR_CACHE_BYTES: u64 = 256 * 1024 * 1024;
/// 캐시 키 해시 입력 맨 앞의 판 표시. 키 구성이나 값 모양을 바꾸면 올린다.
const CACHE_KEY_PREFIX: &[u8] = b"pdfstudio.ocr-cache.v1";
/// 캐시 파일 이름에 쓰는 키 해시 앞부분 바이트 수(16진수 32자)
const CACHE_KEY_HASH_BYTES: usize = 16;
const CACHE_FILE_EXTENSION: &str = "json";
/// 파일 해시를 셀 때 한 번에 읽는 크기
const HASH_READ_BUFFER_BYTES: usize = 1024 * 1024;

/// 렌더 이미지 하나의 OCR 결과. 줄은 읽는 순서이고 좌표는 이미지 픽셀(위·왼쪽 원점)이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct OcrPage {
    pub width: u32,
    pub height: u32,
    pub lines: Vec<OcrLine>,
}

/// 파일 내용의 SHA-256
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileDigest([u8; 32]);

impl FileDigest {
    pub(crate) fn of_file(path: &Path) -> io::Result<Self> {
        let mut file = File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; HASH_READ_BUFFER_BYTES];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        Ok(Self(hasher.finalize().into()))
    }
}

/// 호출자(앱 캐시 폴더를 아는 쪽)가 넘긴 폴더에 쪽별 OCR 결과를 둔다.
#[derive(Debug, Clone)]
pub struct OcrCache {
    dir: PathBuf,
    max_bytes: u64,
}

impl OcrCache {
    /// `dir`이 없으면 처음 쓸 때 만든다. 용량 상한은 [`MAX_OCR_CACHE_BYTES`]다.
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            max_bytes: MAX_OCR_CACHE_BYTES,
        }
    }

    /// 저장한 결과. 없거나 읽을 수 없으면(다른 판·깨진 파일) `None`이다. 찾으면 파일 시각을
    /// 지금으로 바꿔 오래된 것부터 지울 때 뒤로 미룬다.
    pub(crate) fn get(&self, file: FileDigest, page: u32) -> Option<OcrPage> {
        let path = self.entry_path(file, page);
        let bytes = fs::read(&path).ok()?;
        let page = serde_json::from_slice(&bytes).ok()?;
        // 시각 갱신은 지우는 순서에만 쓰므로 실패해도 결과는 그대로 쓴다.
        let _ = File::options()
            .write(true)
            .open(&path)
            .and_then(|file| file.set_modified(SystemTime::now()));
        Some(page)
    }

    /// 결과를 임시 파일에 쓴 뒤 rename한다. 실패하면 캐시 없이 계속한다.
    pub(crate) fn put(&self, file: FileDigest, page: u32, result: &OcrPage) {
        let Ok(bytes) = serde_json::to_vec(result) else {
            return;
        };
        if fs::create_dir_all(&self.dir).is_ok() {
            let _ = write_atomically(&self.entry_path(file, page), &bytes);
        }
    }

    /// 캐시 파일 크기 합이 상한을 넘으면 시각(마지막으로 쓰거나 읽은 때)이 오래된 것부터 지운다.
    /// 캐시 파일(`.json`)만 세고, 쓰는 중인 임시 파일은 건드리지 않는다.
    pub(crate) fn trim(&self) {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        let mut files: Vec<(SystemTime, u64, PathBuf)> = entries
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str())
                    == Some(CACHE_FILE_EXTENSION)
            })
            .filter_map(|entry| {
                let metadata = entry.metadata().ok()?;
                let modified = metadata.modified().ok()?;
                metadata
                    .is_file()
                    .then(|| (modified, metadata.len(), entry.path()))
            })
            .collect();
        let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
        files.sort_by_key(|(modified, _, _)| *modified);
        for (_, size, path) in files {
            if total <= self.max_bytes {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                total -= size;
            }
        }
    }

    fn entry_path(&self, file: FileDigest, page: u32) -> PathBuf {
        let mut hasher = Sha256::new();
        hasher.update(CACHE_KEY_PREFIX);
        hasher.update(file.0);
        hasher.update(page.to_le_bytes());
        // 판 문자열은 상수라 4 GiB를 넘지 않는다.
        let version = OCR_MODEL_VERSION.as_bytes();
        hasher.update(
            u32::try_from(version.len())
                .unwrap_or(u32::MAX)
                .to_le_bytes(),
        );
        hasher.update(version);
        hasher.update(OCR_RENDER_DPI.to_le_bytes());
        let name: String = hasher.finalize()[..CACHE_KEY_HASH_BYTES]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        self.dir.join(name).with_extension(CACHE_FILE_EXTENSION)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    /// 상한을 넘으면 시각이 가장 오래된 캐시 파일부터 지우고, 상한 안이 되면 멈춘다. 캐시 파일이
    /// 아닌 것(쓰는 중인 임시 파일)은 세지도 지우지도 않는다.
    #[test]
    fn trim_removes_oldest_entries_until_under_limit() {
        let dir = std::env::temp_dir().join(format!("pdf-core-ocr-cache-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create cache dir");
        let base = SystemTime::now() - Duration::from_secs(3600);
        for (name, age_rank) in [("newest.json", 3), ("oldest.json", 1), ("middle.json", 2)] {
            let path = dir.join(name);
            fs::write(&path, [0_u8; 10]).expect("write entry");
            File::options()
                .write(true)
                .open(&path)
                .and_then(|file| file.set_modified(base + Duration::from_secs(age_rank)))
                .expect("set entry time");
        }
        fs::write(dir.join(".pdf-studio-writing.tmp"), [0_u8; 100]).expect("write temp");

        OcrCache {
            dir: dir.clone(),
            max_bytes: 20,
        }
        .trim();

        let mut left: Vec<String> = fs::read_dir(&dir)
            .expect("read cache dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        left.sort();
        fs::remove_dir_all(&dir).expect("remove cache dir");
        assert_eq!(
            left,
            [".pdf-studio-writing.tmp", "middle.json", "newest.json"]
        );
    }
}
