//! 이어하기 기록(ADR 0002 §8). 기록 폴더(앱 데이터 폴더 `translations/`, 정하는 것은 `src-tauri`)에
//! `<기록 키>.json`으로 둔다.
//!
//! - 담는 것: 번역에 성공한 문단과 직접 고친 문단(문단 키 → `target`·`edited`), 스캔 쪽의 받아 적은 문단,
//!   누적 사용 토큰. 텍스트 쪽 원문·키는 담지 않는다.
//! - 읽기: 읽을 수 없음, JSON이 아님, `version`이 다름, `recordKey`가 파일 이름과 다름 → 없는 것으로 본다.
//!   `target`·`edited`가 둘 다 없는 문단은 버리고, 그런 문단이 든 스캔 쪽은 쪽째 버린다(다시 보낸다).
//! - 쓰기: 같은 폴더의 임시 파일에 쓰고 디스크에 내린 뒤 rename한다. 쓴 뒤 `.json`이
//!   `MAX_TRANSLATION_RECORDS`개를 넘으면 수정 시각이 오래된 것부터 지운다(방금 쓴 기록은 남긴다).
//! - 세기([`count_translation_records`]): 폴더의 `.json` 수(설정 '일반'의 "n개"). 임시 파일은 세지 않는다.
//! - 지우기([`delete_translation_records`]): 폴더의 `.json`과 남은 임시 파일을 모두 지운다(설정 '일반').

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::record_key::TranslationOptions;
use crate::usage::TokenUsage;

/// 기록 형식 판. 바꾸면 예전 기록은 없는 것으로 본다.
const RECORD_VERSION: u32 = 1;

/// 기록 폴더에 남기는 기록 수 상한(ADR 0002 §8, 계획서 Q8)
const MAX_TRANSLATION_RECORDS: usize = 20;

const RECORD_FILE_EXTENSION: &str = "json";
/// 임시 파일 이름: `.record-<기록 키>-<pid>-<nanos>-<순번>.tmp`. 점으로 시작해 `.json` 목록에 섞이지 않는다.
const TEMP_FILE_PREFIX: &str = ".record-";
const TEMP_FILE_EXTENSION: &str = "tmp";

/// 같은 프로세스·같은 나노초에 만든 임시 파일 이름이 겹치지 않게 하는 순번
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 이어하기 기록 하나(읽기 전용). 계획이 이어하기 가능 여부와 보낼 것을 센다([`crate::plan_translation`]).
pub struct TranslationRecord(pub(crate) Record);

/// 같은 옵션(기록 키)의 기록. 없거나 쓸 수 없으면 `None`이다.
pub fn load_translation_record(
    record_dir: &Path,
    options: &TranslationOptions<'_>,
) -> Option<TranslationRecord> {
    RecordStore::new(record_dir)
        .load(&options.record_key())
        .map(TranslationRecord)
}

/// 기록 폴더에 기록(`.json`)이 하나라도 있는가. 없으면 계획이 파일 해시를 세지 않는다(ADR 0002 §8 "파일 해시").
pub fn has_translation_records(record_dir: &Path) -> bool {
    fs::read_dir(record_dir).is_ok_and(|entries| {
        entries
            .filter_map(Result::ok)
            .any(|entry| is_record_file(&entry.path()))
    })
}

/// 기록 폴더의 기록(`.json`) 수. 임시 파일·다른 파일은 세지 않고, 폴더가 없거나 읽을 수 없으면 0이다.
pub fn count_translation_records(record_dir: &Path) -> usize {
    fs::read_dir(record_dir).map_or(0, |entries| {
        entries
            .filter_map(Result::ok)
            .filter(|entry| is_record_file(&entry.path()))
            .count()
    })
}

/// 기록 폴더의 기록(`.json`)과 남은 임시 파일(`.record-*.tmp`)을 모두 지운다. 다른 파일은 두고, 폴더가 없으면
/// 지울 것이 없다. 항목 하나가 실패해도 나머지는 지우고 첫 실패를 돌려준다.
pub fn delete_translation_records(record_dir: &Path) -> io::Result<()> {
    let entries = match fs::read_dir(record_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let mut first_error = None;
    for entry in entries {
        let removed = entry.and_then(|entry| {
            let path = entry.path();
            if is_record_file(&path) || is_temp_file(&path) {
                fs::remove_file(&path)
            } else {
                Ok(())
            }
        });
        if let Err(error) = removed
            && error.kind() != io::ErrorKind::NotFound
            && first_error.is_none()
        {
            first_error = Some(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

fn is_record_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|extension| extension == RECORD_FILE_EXTENSION)
}

fn is_temp_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|extension| extension == TEMP_FILE_EXTENSION)
        && path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with(TEMP_FILE_PREFIX))
}

/// 기록에 담은 글자층 문단. `target`·`edited` 가운데 적어도 하나는 있다. `edited`가 있으면 직접 고친 문단이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct RecordedParagraph {
    pub target: Option<String>,
    pub edited: Option<String>,
}

/// 기록에 담은 스캔 쪽 문단(받아 적은 원문은 다시 만들 수 없어 담는다)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct RecordedScanParagraph {
    pub key: String,
    pub number: u32,
    pub source: String,
    pub target: Option<String>,
    pub edited: Option<String>,
}

/// 기록 하나(파일 JSON과 같은 모양)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Record {
    version: u32,
    record_key: String,
    created_at_ms: u64,
    pub usage: TokenUsage,
    /// 문단 키 → 번역
    pub paragraphs: BTreeMap<String, RecordedParagraph>,
    /// 쪽 번호(0부터) → 받아 적은 문단(번호 순). 빈 목록은 글이 없는 쪽이다.
    pub scan_pages: BTreeMap<u32, Vec<RecordedScanParagraph>>,
}

impl Record {
    pub(crate) fn new(record_key: &str) -> Self {
        let created_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| {
                u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
            });
        Self {
            version: RECORD_VERSION,
            record_key: record_key.to_owned(),
            created_at_ms,
            usage: TokenUsage::default(),
            paragraphs: BTreeMap::new(),
            scan_pages: BTreeMap::new(),
        }
    }

    /// 담은 문단·스캔 쪽이 없다(파일을 만들지 않는다)
    pub(crate) fn is_empty(&self) -> bool {
        self.paragraphs.is_empty() && self.scan_pages.is_empty()
    }

    /// 읽은 기록이 쓸 만한지 보고, 쓸 수 없는 문단을 버린다.
    fn validated(mut self, record_key: &str) -> Option<Self> {
        if self.version != RECORD_VERSION || self.record_key != record_key {
            return None;
        }
        self.paragraphs
            .retain(|_, paragraph| paragraph.target.is_some() || paragraph.edited.is_some());
        self.scan_pages.retain(|_, paragraphs| {
            paragraphs
                .iter()
                .all(|paragraph| paragraph.target.is_some() || paragraph.edited.is_some())
        });
        Some(self)
    }
}

/// 기록 폴더
pub(crate) struct RecordStore {
    dir: PathBuf,
}

impl RecordStore {
    pub(crate) fn new(dir: &Path) -> Self {
        Self {
            dir: dir.to_path_buf(),
        }
    }

    fn path(&self, record_key: &str) -> PathBuf {
        self.dir
            .join(format!("{record_key}.{RECORD_FILE_EXTENSION}"))
    }

    /// 기록 키의 기록. 없거나 쓸 수 없으면 `None`이다(다음 쓰기가 덮는다).
    pub(crate) fn load(&self, record_key: &str) -> Option<Record> {
        let bytes = match fs::read(self.path(record_key)) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return None,
            Err(error) => {
                log::warn!("번역 기록을 읽지 못했다: {}", error.kind());
                return None;
            }
        };
        let record = serde_json::from_slice::<Record>(&bytes)
            .ok()
            .and_then(|record| record.validated(record_key));
        if record.is_none() {
            log::warn!("번역 기록을 쓸 수 없어 없는 것으로 본다");
        }
        record
    }

    /// 임시 파일 + rename으로 쓰고 기록 수 상한을 지킨다.
    pub(crate) fn save(&self, record: &Record) -> io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        let bytes = serde_json::to_vec(record).map_err(io::Error::other)?;
        let (temp_path, file) = self.create_temp_file(&record.record_key)?;
        let target = self.path(&record.record_key);
        let written = write_synced(file, &bytes).and_then(|()| fs::rename(&temp_path, &target));
        if written.is_err() {
            // 남은 임시 파일은 기록 지우기(`delete_translation_records`)도 지운다.
            fs::remove_file(&temp_path).ok();
        }
        written?;
        self.prune(&target);
        Ok(())
    }

    /// 이미 있는 파일을 덮지 않도록 `create_new`로 만든다.
    fn create_temp_file(&self, record_key: &str) -> io::Result<(PathBuf, File)> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = self.dir.join(format!(
            "{TEMP_FILE_PREFIX}{record_key}-{}-{nanos}-{sequence}.{TEMP_FILE_EXTENSION}",
            std::process::id()
        ));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        Ok((path, file))
    }

    /// `.json`이 상한을 넘으면 수정 시각이 오래된 것부터 지운다. `keep`(방금 쓴 기록)은 지우지 않는다.
    /// 목록·지우기 실패는 경고만 남긴다(다음 쓰기가 다시 지운다).
    fn prune(&self, keep: &Path) {
        let entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(error) => {
                log::warn!("번역 기록 폴더를 읽지 못했다: {}", error.kind());
                return;
            }
        };
        let mut records: Vec<(SystemTime, PathBuf)> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| is_record_file(path))
            .filter_map(|path| {
                let modified = fs::metadata(&path).and_then(|meta| meta.modified()).ok()?;
                Some((modified, path))
            })
            .collect();
        let excess = records.len().saturating_sub(MAX_TRANSLATION_RECORDS);
        records.sort();
        for (_, path) in records.iter().filter(|(_, path)| path != keep).take(excess) {
            if let Err(error) = fs::remove_file(path) {
                log::warn!("오래된 번역 기록을 지우지 못했다: {}", error.kind());
            }
        }
    }
}

/// 쓰고 디스크에 내린 뒤 닫는다. rename 전에 닫아야 Windows에서 바꿔치기가 된다.
fn write_synced(mut file: File, bytes: &[u8]) -> io::Result<()> {
    file.write_all(bytes)?;
    file.sync_all()
}
