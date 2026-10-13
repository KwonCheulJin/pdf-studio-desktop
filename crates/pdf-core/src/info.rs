//! PDF의 페이지 수, 제목, 페이지별 크기·상자·회전을 읽는다.

use std::path::Path;

use pdfium_render::prelude::{
    PdfDocumentMetadataTagType, PdfPage, PdfPageRenderRotation, PdfRect, PdfiumError,
};
use serde::Serialize;

use crate::document::{DocumentError, open_document};
use crate::engine::PdfEngine;

/// 페이지 상자. PDF 사용자 공간 좌표(pt, 원점은 왼쪽 아래)이며 회전 전 값이다.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PageBox {
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
    pub top: f32,
}

/// 직렬화 값은 각도 숫자(0·90·180·270)다. 경계 계약의 `Rotation`과 같은 모양이다(ADR 0001 §7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(into = "u16")]
pub enum PageRotation {
    Degrees0,
    Degrees90,
    Degrees180,
    Degrees270,
}

const DEGREES_0: u16 = 0;
const DEGREES_90: u16 = 90;
const DEGREES_180: u16 = 180;
const DEGREES_270: u16 = 270;

impl From<PageRotation> for u16 {
    fn from(rotation: PageRotation) -> Self {
        match rotation {
            PageRotation::Degrees0 => DEGREES_0,
            PageRotation::Degrees90 => DEGREES_90,
            PageRotation::Degrees180 => DEGREES_180,
            PageRotation::Degrees270 => DEGREES_270,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PageInfo {
    /// 화면에 보이는 너비(pt). CropBox와 `/Rotate`가 반영된 값이다.
    pub width_pt: f32,
    /// 화면에 보이는 높이(pt). CropBox와 `/Rotate`가 반영된 값이다.
    pub height_pt: f32,
    pub rotation: PageRotation,
    pub media_box: PageBox,
    /// 문서에 CropBox가 없으면 `media_box`와 같다.
    pub crop_box: PageBox,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PdfInfo {
    pub page_count: usize,
    /// 제목이 없거나 빈 문자열이면 `None`
    pub title: Option<String>,
    pub pages: Vec<PageInfo>,
}

pub fn read_pdf_info(engine: &PdfEngine, path: &Path) -> Result<PdfInfo, DocumentError> {
    let pdfium = engine.session();
    let document = open_document(&pdfium, path)?;
    let to_error = |source: PdfiumError| DocumentError::Pdfium {
        path: path.to_path_buf(),
        source,
    };

    let title = document
        .metadata()
        .get(PdfDocumentMetadataTagType::Title)
        .map(|tag| tag.value().to_owned())
        .filter(|value| !value.is_empty());
    let pages = document
        .pages()
        .iter()
        .map(|page| page_info(&page))
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_error)?;

    Ok(PdfInfo {
        page_count: pages.len(),
        title,
        pages,
    })
}

fn page_info(page: &PdfPage) -> Result<PageInfo, PdfiumError> {
    let boundaries = page.boundaries();
    let media_rect = boundaries
        .media()
        .map_or_else(|_| page.page_size(), |boundary| boundary.bounds);
    let crop_rect = boundaries
        .crop()
        .map_or(media_rect, |boundary| boundary.bounds);

    Ok(PageInfo {
        width_pt: page.width().value,
        height_pt: page.height().value,
        rotation: rotation_of(page.rotation()?),
        media_box: page_box(media_rect),
        crop_box: page_box(crop_rect),
    })
}

/// 화면에 보이는 영역. pdf.js `page.view`와 같은 정의다: CropBox ∩ MediaBox, 교집합이 비면 MediaBox.
/// 두 상자 모두 Pages 노드에서 물려받은 값을 쓰고 정규화(왼쪽 < 오른쪽, 아래 < 위)한다.
/// `page_info`의 `crop_box`와 달리 MediaBox 밖으로 나간 부분을 잘라 낸다.
pub(crate) fn view_box(page: &PdfPage) -> Result<PageBox, PdfiumError> {
    // pdfium이 쪽을 열 때 계산한 상자(FPDF_GetPageBoundingBox). 상속·정규화·교집합을 이미 했다.
    // 개별 상자 조회(FPDFPage_GetMediaBox 등)는 물려받은 값을 읽지 못한다.
    let visible = page_box(page.boundaries().bounding()?.bounds);
    if visible.right > visible.left && visible.top > visible.bottom {
        return Ok(visible);
    }
    // 교집합이 비면 pdfium은 빈 상자를 주고 pdf.js는 MediaBox를 쓴다. MediaBox를 물려받은
    // 쪽이면 pdfium이 MediaBox를 알려 주지 않으므로 빈 상자를 그대로 둔다.
    Ok(page
        .boundaries()
        .media()
        .map_or(visible, |boundary| normalized(page_box(boundary.bounds))))
}

fn normalized(page_box: PageBox) -> PageBox {
    PageBox {
        left: page_box.left.min(page_box.right),
        bottom: page_box.bottom.min(page_box.top),
        right: page_box.left.max(page_box.right),
        top: page_box.bottom.max(page_box.top),
    }
}

pub(crate) fn rotation_of(rotation: PdfPageRenderRotation) -> PageRotation {
    match rotation {
        PdfPageRenderRotation::None => PageRotation::Degrees0,
        PdfPageRenderRotation::Degrees90 => PageRotation::Degrees90,
        PdfPageRenderRotation::Degrees180 => PageRotation::Degrees180,
        PdfPageRenderRotation::Degrees270 => PageRotation::Degrees270,
    }
}

fn page_box(rect: PdfRect) -> PageBox {
    PageBox {
        left: rect.left().value,
        bottom: rect.bottom().value,
        right: rect.right().value,
        top: rect.top().value,
    }
}
