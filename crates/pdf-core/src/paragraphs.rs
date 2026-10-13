//! 번역할 문단을 추출한다(계획서 §9.1.2 "문단 추출"). 결과 모델과 규칙의 정본은
//! `docs/adr/0002-translation-model.md` §2다. 번역·네트워크·문단 키는 모른다(키는 `crates/translate`).
//!
//! - 입력은 비교 추출 글자(ADR 0001 §8, `read_text_layer`)이고 추출 메모리 캐시([`ExtractionCache`])를
//!   비교와 함께 쓴다. 문단 묶기는 pdfium 잠금 밖에서 한다.
//! - 쪽 범위는 비교와 같은 문법이다(ADR 0001 §13). 범위 안 쪽만 낸다.
//! - 스캔 쪽(`needs_ocr`)은 문단 없이 [`PageParagraphs::Scan`]이다. 그림은 보낼 때
//!   [`render_scan_page`]로 메모리에만 렌더한다.

mod layout;
mod text;

use std::io;
use std::path::Path;
use std::sync::Arc;

use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder, ImageError};
use pdfium_render::prelude::{PdfRenderConfig, PdfiumError};
use serde::Serialize;

use crate::compare::{
    ExtractedPage, ExtractionCache, FileKey, PageSize, ReadText, TextBox, page_numbers,
    read_text_layer,
};
use crate::document::{DocumentError, open_document};
use crate::engine::PdfEngine;

/// 스캔 쪽 그림의 긴 변 상한(px). 비용을 누르는 시작값이다: A4 세로가 1568 × 1109로 그림 토큰
/// ⌈1568/28⌉ × ⌈1109/28⌉ = 2,240이다. 두 모델이 받는 상한은 2576이다(ADR 0002 §15). 작은 한자를
/// 읽는지는 Step 48에서 사용자가 실제로 보내 확인한다.
pub const SCAN_IMAGE_MAX_EDGE_PX: u32 = 1568;

/// 쪽 안 문단 하나
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    /// 쪽 안 순번, 1부터. 읽는 순서다.
    pub number: u32,
    /// 줄을 이은 원문(NFC)
    pub text: String,
    /// 문단 글자 tight 상자를 덮는 사각형(ADR 0001 §2 좌표)
    pub bounds: TextBox,
    /// 대표 글자 크기: 문단 글자 크기의 글자 수 가중 중앙값
    pub font_size: f32,
    /// 제목 문단
    pub heading: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "paragraphs", rename_all = "camelCase")]
pub enum PageParagraphs {
    /// 텍스트 레이어 쪽. 문단이 없을 수 있다.
    Text(Vec<Paragraph>),
    /// 스캔 쪽(비교 추출의 `needs_ocr`). 글자층 글자는 버린다.
    Scan,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphPage {
    /// 문서 전체에서 0부터 센 쪽 번호
    pub page: u32,
    pub size: PageSize,
    pub content: PageParagraphs,
}

#[derive(Debug, thiserror::Error)]
pub enum ParagraphError {
    #[error(transparent)]
    Document(#[from] DocumentError),
    #[error("invalid page range {range:?} ({page_count} pages)")]
    InvalidRange { range: String, page_count: u32 },
    #[error("page {page} is out of range ({page_count} pages)")]
    InvalidPage { page: u32, page_count: u32 },
    #[error("failed to encode the scan page image: {source}")]
    Encode {
        #[source]
        source: ImageError,
    },
}

impl ParagraphError {
    /// 직렬화·화면 문구 선택에 쓰는 안정적인 코드
    pub fn code(&self) -> &'static str {
        match self {
            Self::Document(error) => error.code(),
            Self::InvalidRange { .. } => "INVALID_RANGE",
            Self::InvalidPage { .. } => "INVALID_PAGE",
            Self::Encode { .. } => "IMAGE_ENCODE_FAILED",
        }
    }
}

/// `range`(`"1,3-5"`, 1부터, 비우면 전체) 안 쪽의 문단을 쪽 번호 오름차순으로 낸다.
///
/// - 추출 캐시에 같은 파일(경로·크기·수정 시각)이 있으면 문서를 열지 않는다. 없으면 pdfium 잠금 안에서
///   문서 전체를 읽어 캐시에 넣는다(비교 실행기와 같은 값).
/// - 범위가 잘못되면 [`ParagraphError::InvalidRange`]다.
pub fn extract_paragraphs(
    engine: &PdfEngine,
    path: &Path,
    range: &str,
    cache: &ExtractionCache,
) -> Result<Vec<ParagraphPage>, ParagraphError> {
    let text = read_cached(engine, path, cache)?;
    let page_count = u32::try_from(text.pages.len()).unwrap_or(u32::MAX);
    let numbers = page_numbers(range, page_count).ok_or_else(|| ParagraphError::InvalidRange {
        range: range.to_owned(),
        page_count,
    })?;
    Ok(numbers
        .into_iter()
        .filter_map(|page| {
            let extracted = text.pages.get(page as usize)?;
            Some(paragraph_page(page, extracted))
        })
        .collect())
}

fn read_cached(
    engine: &PdfEngine,
    path: &Path,
    cache: &ExtractionCache,
) -> Result<Arc<ReadText>, DocumentError> {
    let key = FileKey::of(path);
    if let Some(text) = key.as_ref().and_then(|key| cache.get(key)) {
        return Ok(text);
    }
    let pages = read_text_layer(&engine.session(), path)?;
    let text = Arc::new(ReadText::new(pages));
    if let Some(key) = key {
        cache.put(key, Arc::clone(&text));
    }
    Ok(text)
}

fn paragraph_page(page: u32, extracted: &ExtractedPage) -> ParagraphPage {
    let content = if extracted.needs_ocr {
        PageParagraphs::Scan
    } else {
        PageParagraphs::Text(layout::paragraphs(extracted))
    };
    ParagraphPage {
        page,
        size: extracted.size,
        content,
    }
}

/// 쪽(0부터)을 PNG로 렌더한다. 영역은 `view_box`, 방향은 `/Rotate`를 적용한 화면 방향이고, 긴 변이
/// [`SCAN_IMAGE_MAX_EDGE_PX`]가 되게 배율을 정한다. 그림은 메모리에만 두고 파일을 쓰지 않는다.
/// PNG 인코딩은 pdfium 잠금을 놓은 뒤 한다.
pub fn render_scan_page(
    engine: &PdfEngine,
    path: &Path,
    page: u32,
) -> Result<Vec<u8>, ParagraphError> {
    let (width, height, rgb) = render_rgb(engine, path, page)?;
    let mut png = Vec::new();
    PngEncoder::new(io::Cursor::new(&mut png))
        .write_image(&rgb, width, height, ExtendedColorType::Rgb8)
        .map_err(|source| ParagraphError::Encode { source })?;
    Ok(png)
}

/// pdfium 잠금 안에서 렌더해 `(너비, 높이, RGB 바이트)`를 돌려준다.
fn render_rgb(
    engine: &PdfEngine,
    path: &Path,
    page: u32,
) -> Result<(u32, u32, Vec<u8>), ParagraphError> {
    let to_error = |source: PdfiumError| DocumentError::Pdfium {
        path: path.to_path_buf(),
        source,
    };
    let pdfium = engine.session();
    let document = open_document(&pdfium, path)?;
    // 쪽 수는 pdfium의 c_int 범위라 음수가 아니다.
    let page_count = u32::try_from(document.pages().len()).unwrap_or_default();
    let index = i32::try_from(page)
        .ok()
        .filter(|_| page < page_count)
        .ok_or(ParagraphError::InvalidPage { page, page_count })?;
    let pdf_page = document.pages().get(index).map_err(to_error)?;
    let longest_edge = pdf_page.width().value.max(pdf_page.height().value);
    let max_edge = i32::try_from(SCAN_IMAGE_MAX_EDGE_PX).unwrap_or(i32::MAX);
    let scale = if longest_edge > 0.0 {
        SCAN_IMAGE_MAX_EDGE_PX as f32 / longest_edge
    } else {
        1.0
    };
    // 배율 계산의 반올림이 상한을 넘기지 않게 최대 크기도 건다(가로세로 비율은 그대로다).
    let config = PdfRenderConfig::new()
        .scale_page_by_factor(scale)
        .set_maximum_width(max_edge)
        .set_maximum_height(max_edge);
    let bitmap = pdf_page.render_with_config(&config).map_err(to_error)?;
    let width = u32::try_from(bitmap.width()).unwrap_or_default();
    let height = u32::try_from(bitmap.height()).unwrap_or_default();
    let rgb = bitmap
        .as_rgba_bytes()
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect();
    Ok((width, height, rgb))
}
