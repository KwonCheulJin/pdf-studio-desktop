//! 추출 결과 메모리 캐시(계획서 §6.2 6번, ADR 0001 §15). 옵션만 바꿔 다시 비교할 때 텍스트 레이어
//! 추출과 OCR을 건너뛴다.
//!
//! - 키는 (파일 경로, 크기, 수정 시각)이다. 파일을 고치면 크기나 시각이 바뀌어 맞지 않는다.
//! - 값은 문서 전체 쪽의 텍스트 레이어 추출 결과와 OCR에 성공한 쪽의 OCR 글자다. 옵션(쪽 범위·줄
//!   제외·대소문자)과 상관없는 값이라 옵션이 바뀌어도 그대로 쓴다. OCR 실패는 담지 않아 다음 실행에서
//!   다시 시도한다.
//! - 가장 오래 쓰지 않은 문서부터 버린다(LRU).

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::SystemTime;

use crate::compare::extract::{ExtractedChar, ExtractedPage};

/// 캐시에 두는 문서 수. 비교 한 번에 A·B 두 문서를 쓰므로 비교 두 번 분량이다. 옵션만 바꾼 재실행,
/// A↔B 맞바꾸기, 한쪽 파일만 바꾼 비교가 모두 맞는다.
const EXTRACTION_CACHE_DOCUMENTS: usize = 4;

/// 캐시 키: 파일 경로·크기·수정 시각
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FileKey {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
}

impl FileKey {
    /// 파일 정보를 읽지 못하면(없는 파일, 수정 시각을 모르는 파일 시스템) `None`이다. 그때는 캐시 없이
    /// 열고, 열기가 오류를 알린다.
    pub(super) fn of(path: &Path) -> Option<Self> {
        let metadata = fs::metadata(path).ok()?;
        Some(Self {
            path: path.to_path_buf(),
            size: metadata.len(),
            modified: metadata.modified().ok()?,
        })
    }
}

/// 한 파일에서 읽은 글자
#[derive(Debug, Clone)]
pub(super) struct ReadText {
    /// 텍스트 레이어 추출 결과. 색인 = 쪽 번호
    pub(super) pages: Vec<ExtractedPage>,
    /// OCR 글자. 색인 = 쪽 번호이고 OCR에 성공한 쪽만 `Some`이다.
    pub(super) ocr: Vec<Option<Vec<ExtractedChar>>>,
}

impl ReadText {
    pub(super) fn new(pages: Vec<ExtractedPage>) -> Self {
        Self {
            ocr: vec![None; pages.len()],
            pages,
        }
    }
}

/// 추출 결과 메모리 캐시. 앱이 하나를 만들어 비교마다 넘긴다(여러 스레드가 함께 써도 된다).
#[derive(Debug, Default)]
pub struct ExtractionCache {
    /// 앞이 가장 최근에 쓴 문서
    entries: Mutex<VecDeque<(FileKey, Arc<ReadText>)>>,
}

impl ExtractionCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// 찾으면 가장 최근에 쓴 것으로 옮긴다.
    pub(super) fn get(&self, key: &FileKey) -> Option<Arc<ReadText>> {
        let mut entries = self.lock();
        let index = entries.iter().position(|(cached, _)| cached == key)?;
        let entry = entries.remove(index)?;
        let text = Arc::clone(&entry.1);
        entries.push_front(entry);
        Some(text)
    }

    /// 같은 키가 있으면 바꾸고, 넘치면 가장 오래 쓰지 않은 것을 버린다.
    pub(super) fn put(&self, key: FileKey, text: Arc<ReadText>) {
        let mut entries = self.lock();
        entries.retain(|(cached, _)| *cached != key);
        entries.push_front((key, text));
        entries.truncate(EXTRACTION_CACHE_DOCUMENTS);
    }

    /// 표는 넣기·빼기만 하므로 다른 스레드가 패닉해도 내용이 깨지지 않는다. 잠금 오염은 무시한다.
    fn lock(&self) -> MutexGuard<'_, VecDeque<(FileKey, Arc<ReadText>)>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
