//! 텍스트 레이어 글자 추출(계획서 §6.2 1번). 좌표 규칙과 추출 규칙은 ADR 0001 §2·§8이 정본이다.
//!
//! - 글자는 pdfium 텍스트 페이지 순서로 낸다. 정규화·토큰화는 하지 않는다(Step 18).
//! - 순서는 `/Rotate`와 상관없다. pdfium은 화면 방향(`/Rotate` 적용 후)으로 줄 순서를 정해
//!   `/Rotate 90` 쪽에서 내용상 줄 순서를 뒤집는다. 그래서 메모리 안 문서의 `/Rotate`만 0으로
//!   두고 분석한다(문서는 저장하지 않으므로 원본은 그대로다). 상자는 사용자 공간 좌표라 바뀌지 않는다.
//! - 상자는 글리프 모양에 맞춘 tight bounds이고, CropBox 원점이 들어간 절대 사용자 공간
//!   좌표(`/Rotate` 적용 전, `UserUnit`을 곱하지 않은 단위)다. pdfium 값을 그대로 쓴다.
//! - 공백·줄바꿈: 내용 스트림에 있는 공백 글리프는 다른 글자처럼 상자와 함께 낸다. pdfium이
//!   글자 간격·줄 끝을 보고 만든 글자(줄 끝 `\r` `\n`, 단어 사이 공백)는 내용 스트림에 없어
//!   `glyph`가 `None`이다. 토큰화는 `glyph`가 없는 글자를 경계로만 쓴다.
//! - `view_box`와 겹치지 않는 글자(화면에 보이지 않는 글자)는 뺀다. 겹치면 상자를 자르지 않는다.

use std::path::Path;

use pdfium_render::prelude::{
    PdfDocument, PdfPage, PdfPageRenderRotation, PdfPageTextChar, PdfRect, PdfiumError,
};
use serde::Serialize;

use super::model::{PageSize, TextBox};
use crate::document::{DocumentError, open_document};
use crate::engine::PdfEngine;
use crate::info::{PageBox, PageRotation, rotation_of, view_box};

/// 텍스트 레이어 글자(공백 제외)가 이보다 적은 쪽은 OCR 대상이다(계획서 §6.4 1번).
///
/// 스캔본에 디지털로 찍힌 쪽 번호·날짜·도장 문구(보통 30자 아래)만으로는 텍스트 쪽으로 보지 않고,
/// 서명란만 있는 쪽처럼 글자가 적은 텍스트 쪽은 OCR로 읽어도 같은 글자가 나와 손해가 작다.
/// 반대로 놓치면 스캔한 본문 전체가 비교에서 빠지므로 낮은 쪽보다 높은 쪽으로 둔다.
/// 스캔 픽스처(이미지만 있는 쪽)는 0자, 가상 계약서 텍스트 쪽은 수백 자라 값을 그대로 둔다(Step 19-a).
pub const OCR_MIN_TEXT_CHARS: u32 = 32;

/// 내용 스트림에 그려진 글자의 상자와 크기
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Glyph {
    /// tight bounds. `page`는 글자가 있는 쪽이다.
    pub bounds: TextBox,
    /// 사용자 공간에서의 글꼴 크기(`Tf` × 텍스트 행렬·CTM의 세로 배율)
    pub font_size: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedChar {
    /// pdfium이 준 유니코드. 유효한 스칼라 값이 아니면 U+FFFD다.
    pub ch: char,
    /// pdfium이 만든 글자(내용 스트림에 없는 공백·줄바꿈)면 `None`
    pub glyph: Option<Glyph>,
    /// OCR로 읽은 글자의 신뢰도(0~1). 텍스트 레이어 글자는 `None`이다(직렬화하지 않는다).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedPage {
    pub size: PageSize,
    /// 텍스트 순서. `view_box`와 겹치지 않는 글자는 없다.
    pub chars: Vec<ExtractedChar>,
    /// 공백이 아닌 글자가 [`OCR_MIN_TEXT_CHARS`]보다 적다.
    pub needs_ocr: bool,
}

/// 문서의 모든 쪽에서 텍스트 레이어 글자를 읽는다. 색인 = 쪽 번호(0부터).
pub fn extract_text_layer(
    engine: &PdfEngine,
    path: &Path,
) -> Result<Vec<ExtractedPage>, DocumentError> {
    let document = open_document(engine.pdfium(), path)?;
    extract_pages(&document, path).collect()
}

/// 열린 문서의 쪽을 차례로 읽는다(색인 = 쪽 번호). 쪽은 꺼낼 때 읽으므로 호출자가 쪽 사이에서
/// 진행률을 알리거나 멈출 수 있다. `path`는 에러에 남길 문서 경로다.
pub(super) fn extract_pages<'a>(
    document: &'a PdfDocument<'_>,
    path: &'a Path,
) -> impl Iterator<Item = Result<ExtractedPage, DocumentError>> + 'a {
    let to_error = |source: PdfiumError| DocumentError::Pdfium {
        path: path.to_path_buf(),
        source,
    };
    // 쪽 수는 pdfium의 c_int 범위라 u32로 센다(ADR 0001 §1).
    (0_u32..)
        .zip(document.pages().iter())
        .map(move |(page_number, mut page)| extract_page(page_number, &mut page).map_err(to_error))
}

fn extract_page(page_number: u32, page: &mut PdfPage) -> Result<ExtractedPage, PdfiumError> {
    let size = PageSize {
        view_box: view_box(page)?,
        rotation: rotation_of(page.rotation()?),
    };
    if size.rotation != PageRotation::Degrees0 {
        page.set_rotation(PdfPageRenderRotation::None);
    }
    let text = page.text()?;
    let mut chars = Vec::new();
    for text_char in text.chars().iter() {
        let extracted = extract_char(page_number, &text_char)?;
        let is_visible = extracted
            .glyph
            .is_none_or(|glyph| overlaps(&glyph.bounds, &size.view_box));
        if is_visible {
            chars.push(extracted);
        }
    }
    let text_char_count = chars
        .iter()
        .filter(|extracted| extracted.glyph.is_some() && !extracted.ch.is_whitespace())
        .count();
    Ok(ExtractedPage {
        size,
        needs_ocr: text_char_count < OCR_MIN_TEXT_CHARS as usize,
        chars,
    })
}

fn extract_char(
    page_number: u32,
    text_char: &PdfPageTextChar,
) -> Result<ExtractedChar, PdfiumError> {
    let ch = text_char
        .unicode_char()
        .unwrap_or(char::REPLACEMENT_CHARACTER);
    if text_char.is_generated()? {
        return Ok(ExtractedChar {
            ch,
            glyph: None,
            confidence: None,
        });
    }
    // pdfium 글꼴 크기는 `Tf` 값 그대로다. 글자 행렬(텍스트 행렬 × CTM)의 세로 단위 벡터
    // 길이를 곱해야 사용자 공간 크기가 된다(회전한 글자도 같다).
    let matrix = text_char.matrix()?;
    let vertical_scale = matrix.c().hypot(matrix.d());
    Ok(ExtractedChar {
        ch,
        glyph: Some(Glyph {
            bounds: text_box(page_number, text_char.tight_bounds()?),
            font_size: text_char.unscaled_font_size().value * vertical_scale,
        }),
        confidence: None,
    })
}

fn text_box(page: u32, rect: PdfRect) -> TextBox {
    let (left, right) = (rect.left().value, rect.right().value);
    let (bottom, top) = (rect.bottom().value, rect.top().value);
    TextBox {
        page,
        x: left.min(right),
        y: bottom.min(top),
        w: (right - left).abs(),
        h: (top - bottom).abs(),
    }
}

/// 닫힌 구간으로 겹치는지 본다. 너비나 높이가 0인 상자(공백 글리프)도 안에 있으면 겹친다.
fn overlaps(bounds: &TextBox, view_box: &PageBox) -> bool {
    bounds.x <= view_box.right
        && bounds.x + bounds.w >= view_box.left
        && bounds.y <= view_box.top
        && bounds.y + bounds.h >= view_box.bottom
}
