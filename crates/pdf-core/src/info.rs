//! PDF의 페이지 수, 제목, 페이지별 크기·상자·회전을 읽는다.

use std::path::Path;

use pdfium_render::prelude::{
    PdfDocumentMetadataTagType, PdfPage, PdfPageRenderRotation, PdfRect, PdfiumError,
};

use crate::document::{DocumentError, open_document};
use crate::engine::PdfEngine;

/// 페이지 상자. PDF 사용자 공간 좌표(pt, 원점은 왼쪽 아래)이며 회전 전 값이다.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageBox {
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
    pub top: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageRotation {
    Degrees0,
    Degrees90,
    Degrees180,
    Degrees270,
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
    let document = open_document(engine.pdfium(), path)?;
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

fn rotation_of(rotation: PdfPageRenderRotation) -> PageRotation {
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
