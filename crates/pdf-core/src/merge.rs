//! 여러 PDF에서 고른 페이지를 새 문서로 합치고, 페이지마다 요청한 회전을 적용해 저장한다.

mod progress;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use pdfium_render::prelude::{PdfDocument, PdfPageRenderRotation, Pdfium, PdfiumError};

use crate::document::{DocumentError, open_document};
use crate::engine::PdfEngine;
use crate::info::PageRotation;
use crate::output::{SaveError, ensure_output_directory, save_atomically};
use progress::ProgressReporter;

pub use progress::{MergeProgress, MergeStage};

/// 병합 요청 하나에 넣을 수 있는 소스 파일 수의 상한
pub const MAX_MERGE_FILES: usize = 200;

/// 저장 단계의 작업 단위 수(저장 한 번)
const SAVE_UNITS: usize = 1;
/// pdfium 페이지 범위 문자열("3,1,1")의 구분자
const PAGE_RANGE_SEPARATOR: &str = ",";

#[derive(Debug, Clone)]
pub struct MergeRequest {
    pub sources: Vec<MergeSource>,
    /// 결과를 쓸 경로. 폴더는 이미 있어야 한다: 저장 다이얼로그에서 고른 경로이거나
    /// 앱 임시 폴더 안의 경로만 들어온다.
    pub output_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct MergeSource {
    pub path: PathBuf,
    /// 출력에 넣을 페이지. 목록 순서가 출력 순서이고, 같은 페이지를 여러 번 넣어도 된다.
    pub pages: Vec<MergePage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MergePage {
    /// 소스 문서 안에서 0부터 센 페이지 번호
    pub index: usize,
    /// 출력 페이지의 최종 회전. 원본 `/Rotate`에 더하지 않고 이 값으로 바꾼다.
    pub rotation: PageRotation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MergeResult {
    pub page_count: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum MergeError {
    #[error("merge request has no sources")]
    EmptyRequest,
    #[error("merge request has {count} sources, over the {limit} source limit")]
    TooManyFiles { count: usize, limit: usize },
    #[error("source {source_index} has no pages to merge: {path}")]
    EmptySource { source_index: usize, path: PathBuf },
    #[error(
        "page index {page_index} is out of range for source {source_index} \
         with {page_count} pages: {path}"
    )]
    InvalidPage {
        source_index: usize,
        page_index: usize,
        page_count: usize,
        path: PathBuf,
    },
    #[error("merge was cancelled")]
    Cancelled,
    #[error(transparent)]
    Document(#[from] DocumentError),
    #[error(transparent)]
    Save(#[from] SaveError),
}

impl MergeError {
    /// 직렬화·화면 문구 선택에 쓰는 안정적인 코드. 변형의 이름이 바뀌어도 값은 유지한다.
    pub fn code(&self) -> &'static str {
        match self {
            Self::EmptyRequest => "EMPTY_REQUEST",
            Self::TooManyFiles { .. } => "TOO_MANY_FILES",
            Self::EmptySource { .. } => "EMPTY_SOURCE",
            Self::InvalidPage { .. } => "INVALID_PAGE",
            Self::Cancelled => "CANCELLED",
            Self::Document(error) => error.code(),
            Self::Save(error) => error.code(),
        }
    }
}

/// `ReadFiles` → `MergePages` → `Save` 순서로 병합한다.
///
/// - 요청·소스 검증은 모두 출력 파일을 만들기 전에 끝난다.
/// - `cancel`은 파일마다·페이지마다·저장 직전에 확인하고, 켜져 있으면 `Cancelled`를 돌려준다.
///   이때 출력 파일과 임시 파일은 남지 않는다.
/// - 소스 파일은 읽기만 한다.
pub fn merge_pdfs(
    engine: &PdfEngine,
    request: &MergeRequest,
    cancel: &AtomicBool,
    on_progress: impl FnMut(MergeProgress),
) -> Result<MergeResult, MergeError> {
    validate_request(request)?;
    let pdfium = engine.pdfium();
    let mut reporter = ProgressReporter::new(on_progress);
    let page_count = request
        .sources
        .iter()
        .map(|source| source.pages.len())
        .sum();

    read_sources(pdfium, request, cancel, &mut reporter)?;
    let merged = merge_pages(pdfium, request, page_count, cancel, &mut reporter)?;

    reporter.report(MergeStage::Save, 0, SAVE_UNITS);
    ensure_not_cancelled(cancel)?;
    save_atomically(&merged, &request.output_path)?;
    reporter.report(MergeStage::Save, SAVE_UNITS, SAVE_UNITS);

    Ok(MergeResult { page_count })
}

/// 파일을 열지 않고 할 수 있는 검사: 소스 수, 빈 소스, 출력 폴더
fn validate_request(request: &MergeRequest) -> Result<(), MergeError> {
    let count = request.sources.len();
    if count == 0 {
        return Err(MergeError::EmptyRequest);
    }
    if count > MAX_MERGE_FILES {
        return Err(MergeError::TooManyFiles {
            count,
            limit: MAX_MERGE_FILES,
        });
    }
    let empty_source = request
        .sources
        .iter()
        .enumerate()
        .find(|(_, source)| source.pages.is_empty());
    if let Some((source_index, source)) = empty_source {
        return Err(MergeError::EmptySource {
            source_index,
            path: source.path.clone(),
        });
    }
    ensure_output_directory(&request.output_path)?;
    Ok(())
}

/// 소스를 하나씩 열어 검사하고 바로 닫는다. 모두 열어 둔 채 병합하면 파일 핸들이
/// 소스 수만큼 필요한데, macOS 앱의 기본 상한(256)이 `MAX_MERGE_FILES`와 가깝다.
fn read_sources(
    pdfium: &Pdfium,
    request: &MergeRequest,
    cancel: &AtomicBool,
    reporter: &mut ProgressReporter<impl FnMut(MergeProgress)>,
) -> Result<(), MergeError> {
    let total = request.sources.len();
    reporter.report(MergeStage::ReadFiles, 0, total);
    for (source_index, source) in request.sources.iter().enumerate() {
        ensure_not_cancelled(cancel)?;
        open_source(pdfium, source_index, source)?;
        reporter.report(MergeStage::ReadFiles, source_index + 1, total);
    }
    Ok(())
}

fn merge_pages<'a>(
    pdfium: &'a Pdfium,
    request: &MergeRequest,
    total: usize,
    cancel: &AtomicBool,
    reporter: &mut ProgressReporter<impl FnMut(MergeProgress)>,
) -> Result<PdfDocument<'a>, MergeError> {
    let output_error = |source| pdfium_error(&request.output_path, source);
    let mut merged = pdfium.create_new_pdf().map_err(output_error)?;
    let mut done = 0;
    reporter.report(MergeStage::MergePages, 0, total);

    for (source_index, source) in request.sources.iter().enumerate() {
        ensure_not_cancelled(cancel)?;
        let document = open_source(pdfium, source_index, source)?;
        let first_index = merged.pages().len();
        // 소스 하나의 페이지를 한 번에 가져와야 폰트·이미지 같은 공유 리소스가 한 번만 복사된다.
        merged
            .pages_mut()
            .copy_pages_from_document(&document, &page_range(source), first_index)
            .map_err(|error| pdfium_error(&source.path, error))?;

        for (page_index, merge_page) in (first_index..).zip(&source.pages) {
            ensure_not_cancelled(cancel)?;
            let mut page = merged.pages().get(page_index).map_err(output_error)?;
            page.set_rotation(render_rotation(merge_page.rotation));
            done += 1;
            reporter.report(MergeStage::MergePages, done, total);
        }
    }
    Ok(merged)
}

/// 소스를 열고(크기·암호·형식 검사) 요청한 페이지 번호가 모두 범위 안인지 확인한다.
fn open_source<'a>(
    pdfium: &'a Pdfium,
    source_index: usize,
    source: &MergeSource,
) -> Result<PdfDocument<'a>, MergeError> {
    let document = open_document(pdfium, &source.path)?;
    // pdfium 페이지 수는 음수가 아니다. 만약 변환에 실패하면 0쪽으로 보고 모든 번호를 거부한다.
    let page_count = usize::try_from(document.pages().len()).unwrap_or_default();
    let out_of_range = source.pages.iter().find(|page| page.index >= page_count);
    if let Some(page) = out_of_range {
        return Err(MergeError::InvalidPage {
            source_index,
            page_index: page.index,
            page_count,
            path: source.path.clone(),
        });
    }
    Ok(document)
}

/// 1부터 세는 pdfium 페이지 범위 문자열. 요청 순서와 중복을 그대로 따른다.
fn page_range(source: &MergeSource) -> String {
    source
        .pages
        .iter()
        .map(|page| (page.index + 1).to_string())
        .collect::<Vec<_>>()
        .join(PAGE_RANGE_SEPARATOR)
}

fn render_rotation(rotation: PageRotation) -> PdfPageRenderRotation {
    match rotation {
        PageRotation::Degrees0 => PdfPageRenderRotation::None,
        PageRotation::Degrees90 => PdfPageRenderRotation::Degrees90,
        PageRotation::Degrees180 => PdfPageRenderRotation::Degrees180,
        PageRotation::Degrees270 => PdfPageRenderRotation::Degrees270,
    }
}

fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<(), MergeError> {
    if cancel.load(Ordering::Relaxed) {
        Err(MergeError::Cancelled)
    } else {
        Ok(())
    }
}

fn pdfium_error(path: &Path, source: PdfiumError) -> MergeError {
    MergeError::Document(DocumentError::Pdfium {
        path: path.to_path_buf(),
        source,
    })
}
