//! 비교 결과를 PDF로 내보낸다(계획서 §6.2 7번). 규칙의 정본은 ADR 0001 §14다.
//!
//! - 비교 PDF: `page_pairs` 행 하나를 A4 가로 한 장에 놓고, 변경 상자를 색 사각형으로 그린다.
//! - 주석 PDF: B 문서 사본에 변경마다 PDF 주석을 단다.
//! - 둘 다 임시 파일 + rename으로 저장하고, 출력 경로가 입력 파일이면 거부한다. 입력 파일은 읽기만 한다.
//! - 미리보기는 비교 PDF의 첫 장들을 메모리에서 만들어 PNG로 렌더한다. 파일을 쓰지 않는다.

mod annotate;
mod compose;
mod sheet;
#[cfg(test)]
mod tests;

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder, ImageError};
use pdfium_render::prelude::{PdfColor, PdfRenderConfig, PdfiumError};

use super::model::{ChangeKind, CompareResult, Side};
use crate::document::DocumentError;
use crate::engine::PdfEngine;
use crate::output::{SaveError, ensure_output_directory, save_atomically};
use sheet::{Marks, plan_sheets};

/// 미리보기 이미지 너비의 상한(px). 내보내기 모달 미리보기 칸(약 640 CSS px)을 2배 밀도로 그려도 남는다.
pub const MAX_PREVIEW_WIDTH_PX: u32 = 2400;

/// 디자인 토큰 `diff-insert` / `diff-insert-fill`(`docs/06-design-system.md`)
const INSERT_STROKE: PdfColor = PdfColor::new(0x1f, 0x6f, 0xeb, 0xff);
const INSERT_FILL: PdfColor = PdfColor::new(0x1f, 0x6f, 0xeb, 0x33);
/// 디자인 토큰 `diff-delete` / `diff-delete-fill`
const DELETE_STROKE: PdfColor = PdfColor::new(0xd4, 0x50, 0x0f, 0xff);
const DELETE_FILL: PdfColor = PdfColor::new(0xd4, 0x50, 0x0f, 0x33);
/// 디자인 토큰 `diff-change` / `diff-change-fill`
const CHANGE_STROKE: PdfColor = PdfColor::new(0xa6, 0x7a, 0x00, 0xff);
const CHANGE_FILL: PdfColor = PdfColor::new(0xe0, 0xa8, 0x00, 0x40);

/// 비교 PDF 한 장에 쪽을 놓는 방식(화면의 `나란히 | A만 | B만`)
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ReportLayout {
    /// 왼쪽 A, 오른쪽 B. 짝 없는 행은 빈 쪽 자리를 점선 테두리로 둔다.
    #[default]
    SideBySide,
    /// A 쪽만. B만 있는 행은 넣지 않는다.
    AOnly,
    /// B 쪽만. A만 있는 행은 넣지 않는다.
    BOnly,
}

/// 비교 PDF 옵션. 기본값은 나란히, 모든 행, 색 상자 넣기, 숨긴 종류 없음이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompareReportOptions {
    pub layout: ReportLayout,
    /// 그 장에 보이는 쪽에 (숨기지 않은) 변경 상자가 하나라도 있는 장만 넣는다.
    pub changed_pages_only: bool,
    /// 변경 상자를 색 사각형으로 그린다.
    pub draw_boxes: bool,
    /// 화면 필터에서 끈 종류. 이 종류의 변경은 그리지 않고 차이 있는 쪽 판정에도 쓰지 않는다.
    pub hidden_kinds: Vec<ChangeKind>,
}

impl Default for CompareReportOptions {
    fn default() -> Self {
        Self {
            layout: ReportLayout::default(),
            changed_pages_only: false,
            draw_boxes: true,
            hidden_kinds: Vec::new(),
        }
    }
}

/// 비교한 두 PDF 파일. `CompareResult`를 만든 바로 그 파일이어야 한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportSources {
    pub before: PathBuf,
    pub after: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompareReport {
    pub sheet_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnnotatedReport {
    pub annotation_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportPreview {
    /// 같은 옵션으로 내보낼 때의 전체 장 수(미리보기로 그린 장 수가 아니다)
    pub sheet_count: u32,
    /// 첫 장부터 차례로, 장마다 PNG 바이트
    pub images: Vec<Vec<u8>>,
}

#[derive(Debug, thiserror::Error)]
pub enum ReportError {
    #[error("output path is one of the compared files: {path}")]
    OutputIsSource { path: PathBuf },
    #[error("page {page} of {side:?} is out of range for {path} with {page_count} pages")]
    InvalidPage {
        side: Side,
        page: u32,
        page_count: u32,
        path: PathBuf,
    },
    #[error("report has no pages with the given options")]
    EmptyReport,
    #[error("report export was cancelled")]
    Cancelled,
    #[error("pdfium failed to compose the report: {source}")]
    Compose {
        #[source]
        source: PdfiumError,
    },
    #[error("failed to encode the preview image: {source}")]
    Encode {
        #[source]
        source: ImageError,
    },
    #[error(transparent)]
    Document(#[from] DocumentError),
    #[error(transparent)]
    Save(#[from] SaveError),
}

impl ReportError {
    /// 직렬화·화면 문구 선택에 쓰는 안정적인 코드. 변형의 이름이 바뀌어도 값은 유지한다.
    pub fn code(&self) -> &'static str {
        match self {
            Self::OutputIsSource { .. } => "OUTPUT_IS_SOURCE",
            Self::InvalidPage { .. } => "INVALID_PAGE",
            Self::EmptyReport => "EMPTY_REPORT",
            Self::Cancelled => "CANCELLED",
            Self::Compose { .. } => "PDFIUM_FAILURE",
            Self::Encode { .. } => "IMAGE_ENCODE_FAILED",
            Self::Document(error) => error.code(),
            Self::Save(error) => error.code(),
        }
    }
}

/// 비교 PDF를 만든다. `cancel`은 장마다·저장 직전에 확인하고, 켜져 있으면 `Cancelled`를
/// 돌려준다. 이때 출력 파일과 임시 파일은 남지 않는다.
pub fn export_compare_pdf(
    engine: &PdfEngine,
    result: &CompareResult,
    sources: &ReportSources,
    options: &CompareReportOptions,
    output_path: &Path,
    cancel: &AtomicBool,
) -> Result<CompareReport, ReportError> {
    ensure_not_source(output_path, &[&sources.before, &sources.after])?;
    ensure_output_directory(output_path)?;
    let marks = Marks::collect(result, &options.hidden_kinds);
    let sheets = plan_sheets(result, options, &marks);
    if sheets.is_empty() {
        return Err(ReportError::EmptyReport);
    }

    let document = compose::compose(
        engine.pdfium(),
        result,
        sources,
        options,
        &marks,
        &sheets,
        cancel,
    )?;
    ensure_not_cancelled(cancel)?;
    save_atomically(&document, output_path)?;
    Ok(CompareReport {
        sheet_count: count(sheets.len()),
    })
}

/// B 문서 사본에 변경마다 주석을 단 PDF를 만든다. 숨긴 종류의 변경은 달지 않는다.
/// `cancel`은 쪽마다·저장 직전에 확인한다.
pub fn export_annotated_pdf(
    engine: &PdfEngine,
    result: &CompareResult,
    after_path: &Path,
    hidden_kinds: &[ChangeKind],
    output_path: &Path,
    cancel: &AtomicBool,
) -> Result<AnnotatedReport, ReportError> {
    ensure_not_source(output_path, &[after_path])?;
    ensure_output_directory(output_path)?;
    let (document, annotation_count) =
        annotate::annotate(engine.pdfium(), result, after_path, hidden_kinds, cancel)?;
    ensure_not_cancelled(cancel)?;
    save_atomically(&document, output_path)?;
    Ok(AnnotatedReport { annotation_count })
}

/// 같은 옵션으로 만든 비교 PDF의 첫 `max_sheets`장을 너비 `width_px`(1 ~ [`MAX_PREVIEW_WIDTH_PX`]로
/// 자른다)로 렌더해 PNG로 돌려준다. 문서는 메모리에만 만든다.
pub fn preview_compare_report(
    engine: &PdfEngine,
    result: &CompareResult,
    sources: &ReportSources,
    options: &CompareReportOptions,
    max_sheets: u32,
    width_px: u32,
) -> Result<ReportPreview, ReportError> {
    let marks = Marks::collect(result, &options.hidden_kinds);
    let sheets = plan_sheets(result, options, &marks);
    if sheets.is_empty() {
        return Err(ReportError::EmptyReport);
    }
    let shown = usize::try_from(max_sheets).map_or(sheets.len(), |max| max.min(sheets.len()));
    let never_cancelled = AtomicBool::new(false);
    let document = compose::compose(
        engine.pdfium(),
        result,
        sources,
        options,
        &marks,
        &sheets[..shown],
        &never_cancelled,
    )?;

    let config = PdfRenderConfig::new().set_target_width(preview_width(width_px));
    let images = document
        .pages()
        .iter()
        .map(|page| {
            let bitmap = page
                .render_with_config(&config)
                .map_err(|source| ReportError::Compose { source })?;
            encode_png(
                &bitmap.as_rgba_bytes(),
                u32::try_from(bitmap.width()).unwrap_or_default(),
                u32::try_from(bitmap.height()).unwrap_or_default(),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ReportPreview {
        sheet_count: count(sheets.len()),
        images,
    })
}

/// 변경 종류의 (선 색, 채움 색)
fn kind_colors(kind: ChangeKind) -> (PdfColor, PdfColor) {
    match kind {
        ChangeKind::Insert => (INSERT_STROKE, INSERT_FILL),
        ChangeKind::Delete => (DELETE_STROKE, DELETE_FILL),
        ChangeKind::Replace => (CHANGE_STROKE, CHANGE_FILL),
    }
}

/// 출력 파일이 이미 있고 입력 파일 중 하나와 같은 파일(링크·`..`을 푼 경로)이면 거부한다.
/// 출력 파일이 없으면 있는 파일인 입력과 같을 수 없다.
fn ensure_not_source(output_path: &Path, inputs: &[&Path]) -> Result<(), ReportError> {
    let Ok(output) = output_path.canonicalize() else {
        return Ok(());
    };
    let is_source = inputs
        .iter()
        .any(|input| input.canonicalize().is_ok_and(|input| input == output));
    if is_source {
        Err(ReportError::OutputIsSource {
            path: output_path.to_path_buf(),
        })
    } else {
        Ok(())
    }
}

fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<(), ReportError> {
    if cancel.load(Ordering::Relaxed) {
        Err(ReportError::Cancelled)
    } else {
        Ok(())
    }
}

fn preview_width(width_px: u32) -> i32 {
    // 상한이 i32 안이므로 변환은 실패하지 않는다. 실패하면 가장 작은 너비로 그린다.
    i32::try_from(width_px.clamp(1, MAX_PREVIEW_WIDTH_PX)).unwrap_or(1)
}

fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, ReportError> {
    let mut png = Vec::new();
    PngEncoder::new(io::Cursor::new(&mut png))
        .write_image(rgba, width, height, ExtendedColorType::Rgba8)
        .map_err(|source| ReportError::Encode { source })?;
    Ok(png)
}

/// 장·쪽·주석 수는 문서 쪽 수(pdfium `c_int`) 범위라 `u32`에 들어간다. 넘치면 최댓값으로 둔다.
fn count(length: usize) -> u32 {
    u32::try_from(length).unwrap_or(u32::MAX)
}
