//! 비교 PDF 문서를 pdfium으로 만든다. 원본 쪽은 Form XObject로 가져와 내용 스트림·리소스를 그대로
//! 쓰므로 글자는 벡터로 남고 원본 파일은 읽기만 한다.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use pdfium_render::prelude::{
    PdfColor, PdfDocument, PdfPage, PdfPageContentRegenerationStrategy, PdfPageObjectCommon,
    PdfPageObjectsCommon, PdfPagePaperSize, PdfPagePathObject, PdfPoints, PdfRect, Pdfium,
    PdfiumError,
};

use super::super::model::{ChangeKind, CompareResult, PageSize, Side};
use super::sheet::{
    Mark, Marks, Placement, SHEET_HEIGHT_PT, SHEET_WIDTH_PT, Sheet, inflate, intersect, slots,
};
use super::{
    CompareReportOptions, ReportError, ReportLayout, ReportSources, ensure_not_cancelled,
    kind_colors,
};
use crate::document::{DocumentError, open_document};
use crate::info::PageBox;

/// 디자인 토큰 `border`(oklch(0.905 0.008 285) ≈ #dfdfe5). 놓인 쪽의 테두리와 빈 쪽 자리에 쓴다.
const BORDER_COLOR: PdfColor = PdfColor::new(0xdf, 0xdf, 0xe5, 0xff);
const BORDER_WIDTH_PT: f32 = 0.75;
/// 차이 상자 선 굵기. 확인 필요 상자는 채우지 않는 대신 선을 굵게 한다.
const BOX_STROKE_WIDTH_PT: f32 = 0.75;
const REVIEW_STROKE_WIDTH_PT: f32 = 1.5;
/// 글자 tight 상자(ADR 0001 §8)에 붙지 않도록 장 좌표에서 사방으로 넓히는 양
const BOX_PADDING_PT: f32 = 1.0;
/// 점선 무늬(선, 빈칸 길이). 빈 쪽 자리와 변경(`Replace`) 상자에 쓴다. 토큰 문서가 변경을 점선으로
/// 구분하므로(색각 이상에서 삭제 주황과 변경 노랑을 가린다) 화면과 같은 구분을 둔다.
const DASH_PATTERN_PT: [f32; 2] = [3.0, 2.0];

/// 장들을 차례로 만든다. `cancel`은 장마다 확인한다.
pub(super) fn compose<'a>(
    pdfium: &'a Pdfium,
    result: &CompareResult,
    sources: &ReportSources,
    options: &CompareReportOptions,
    marks: &Marks,
    sheets: &[Sheet],
    cancel: &AtomicBool,
) -> Result<PdfDocument<'a>, ReportError> {
    let before = SourceDocument::open(pdfium, Side::Before, &sources.before, result, sheets)?;
    let after = SourceDocument::open(pdfium, Side::After, &sources.after, result, sheets)?;
    let mut document = pdfium.create_new_pdf().map_err(compose_error)?;
    let (before_slot, after_slot) = slots(options.layout);

    for sheet in sheets {
        ensure_not_cancelled(cancel)?;
        let mut page = document
            .pages_mut()
            .create_page_at_end(PdfPagePaperSize::Custom(
                PdfPoints::new(SHEET_WIDTH_PT),
                PdfPoints::new(SHEET_HEIGHT_PT),
            ))
            .map_err(compose_error)?;
        // 객체를 넣을 때마다 내용 스트림을 다시 만들지 않고 장을 다 그린 뒤 한 번 만든다.
        page.set_content_regeneration_strategy(PdfPageContentRegenerationStrategy::Manual);

        let placed_before = place(before.as_ref(), sheet.before, before_slot);
        let placed_after = place(after.as_ref(), sheet.after, after_slot);
        let mut canvas = Canvas {
            document: &mut document,
            page: &mut page,
        };
        for (placed, page_marks) in [
            (&placed_before, sheet.before.map(|page| marks.before(page))),
            (&placed_after, sheet.after.map(|page| marks.after(page))),
        ] {
            let Some(placed) = placed else {
                continue;
            };
            canvas.place_page(placed)?;
            canvas.frame(placed.placement.frame(), false)?;
            if options.draw_boxes {
                for mark in page_marks.unwrap_or_default() {
                    canvas.mark(mark, &placed.placement)?;
                }
            }
        }
        if options.layout == ReportLayout::SideBySide {
            canvas.empty_slot(placed_before.as_ref(), placed_after.as_ref())?;
        }
        page.regenerate_content().map_err(compose_error)?;
    }
    Ok(document)
}

/// 장에 쓰는 원본 문서 한쪽과 그 쪽 크기 목록
struct SourceDocument<'a, 'r> {
    path: &'r Path,
    document: PdfDocument<'a>,
    sizes: &'r [PageSize],
}

impl<'a, 'r> SourceDocument<'a, 'r> {
    /// 장에 이 쪽이 하나라도 있으면 열고, 장이 가리키는 쪽 번호가 문서와 결과의 쪽 크기 목록 안인지
    /// 확인한다. 없으면 열지 않는다.
    fn open(
        pdfium: &'a Pdfium,
        side: Side,
        path: &'r Path,
        result: &'r CompareResult,
        sheets: &[Sheet],
    ) -> Result<Option<Self>, ReportError> {
        let pages = sheets.iter().filter_map(|sheet| match side {
            Side::Before => sheet.before,
            Side::After => sheet.after,
        });
        let sizes = match side {
            Side::Before => result.page_sizes.before.as_slice(),
            Side::After => result.page_sizes.after.as_slice(),
        };
        let Some(last_page) = pages.max() else {
            return Ok(None);
        };
        let document = open_document(pdfium, path)?;
        ensure_page_in_range(side, path, last_page, document.pages().len(), sizes.len())?;
        Ok(Some(Self {
            path,
            document,
            sizes,
        }))
    }
}

/// 칸에 놓을 원본 쪽 하나
struct PlacedPage<'s, 'a, 'r> {
    source: &'s SourceDocument<'a, 'r>,
    page: u32,
    size: PageSize,
    placement: Placement,
}

/// 칸·쪽·원본 문서가 모두 있으면 쪽을 칸에 맞춘다. 쪽 번호는 `SourceDocument::open`이 확인했다.
fn place<'s, 'a, 'r>(
    source: Option<&'s SourceDocument<'a, 'r>>,
    page: Option<u32>,
    slot: Option<PageBox>,
) -> Option<PlacedPage<'s, 'a, 'r>> {
    let (source, page, slot) = (source?, page?, slot?);
    let size = *source.sizes.get(usize::try_from(page).ok()?)?;
    Some(PlacedPage {
        source,
        page,
        size,
        placement: Placement::fit(&size, slot),
    })
}

/// 쪽 번호가 pdfium 문서 쪽 수와 결과의 쪽 크기 목록 둘 다의 안인지 확인한다.
pub(super) fn ensure_page_in_range(
    side: Side,
    path: &Path,
    page: u32,
    document_pages: i32,
    known_sizes: usize,
) -> Result<(), ReportError> {
    let page_count = u32::try_from(document_pages).unwrap_or_default();
    let in_sizes = usize::try_from(page).is_ok_and(|index| index < known_sizes);
    if page < page_count && in_sizes {
        Ok(())
    } else {
        Err(ReportError::InvalidPage {
            side,
            page,
            page_count,
            path: path.to_path_buf(),
        })
    }
}

/// 그리는 중인 장 한 장
struct Canvas<'d, 'a> {
    document: &'d mut PdfDocument<'a>,
    page: &'d mut PdfPage<'a>,
}

impl<'a> Canvas<'_, 'a> {
    /// 원본 쪽을 Form XObject로 가져와 배치대로 놓는다.
    fn place_page(&mut self, placed: &PlacedPage<'_, 'a, '_>) -> Result<(), ReportError> {
        let source_error = |error| source_pdfium_error(placed.source.path, error);
        // 쪽 번호는 `SourceDocument::open`이 pdfium 쪽 수(`i32`) 안인지 확인했다.
        let index = i32::try_from(placed.page).unwrap_or(i32::MAX);
        let mut source_page = placed
            .source
            .document
            .pages()
            .get(index)
            .map_err(source_error)?;
        // `objects()`는 쪽을 빌린 수명으로 묶여 다른 문서에 넣을 수 없다. `objects_mut()`는 문서
        // 수명이라 쓴다. 원본 쪽은 바꾸지 않는다.
        let mut object = source_page
            .objects_mut()
            .copy_into_x_object_form_object(self.document)
            .map_err(source_error)?;
        let (left, bottom) = placed.placement.origin();
        let scale = placed.placement.scale();
        object
            .transform(scale, 0.0, 0.0, scale, left, bottom)
            .map_err(compose_error)?;
        self.page
            .objects_mut()
            .add_object(object)
            .map_err(compose_error)?;
        Ok(())
    }

    /// 놓인 쪽의 테두리(흰 쪽이 흰 장과 구분되게), `dashed`면 빈 쪽 자리
    fn frame(&mut self, rect: PageBox, dashed: bool) -> Result<(), ReportError> {
        self.rect(rect, BORDER_COLOR, BORDER_WIDTH_PT, None, dashed)
    }

    /// 나란히 배치에서 짝 없는 행의 빈 칸에, 있는 쪽과 같은 크기의 점선 자리를 그린다.
    fn empty_slot(
        &mut self,
        placed_before: Option<&PlacedPage>,
        placed_after: Option<&PlacedPage>,
    ) -> Result<(), ReportError> {
        let (before_slot, after_slot) = slots(ReportLayout::SideBySide);
        let mirrored = match (placed_before, placed_after) {
            (Some(placed), None) => after_slot.map(|slot| (placed.size, slot)),
            (None, Some(placed)) => before_slot.map(|slot| (placed.size, slot)),
            _ => None,
        };
        match mirrored {
            Some((size, slot)) => self.frame(Placement::fit(&size, slot).frame(), true),
            None => Ok(()),
        }
    }

    /// 변경 상자 하나. 차이는 종류 색으로 옅게 채우고 같은 색 선을 두른다. 확인 필요는 채우지 않고
    /// 굵은 선만 둔다. 놓인 쪽 밖으로 나간 부분은 자른다.
    fn mark(&mut self, mark: &Mark, placement: &Placement) -> Result<(), ReportError> {
        let rect = inflate(placement.map(mark.bounds), BOX_PADDING_PT);
        let Some(rect) = intersect(rect, placement.frame()) else {
            return Ok(());
        };
        let (stroke, fill) = kind_colors(mark.kind);
        let dashed = mark.kind == ChangeKind::Replace;
        if mark.needs_review {
            self.rect(rect, stroke, REVIEW_STROKE_WIDTH_PT, None, dashed)
        } else {
            self.rect(rect, stroke, BOX_STROKE_WIDTH_PT, Some(fill), dashed)
        }
    }

    fn rect(
        &mut self,
        rect: PageBox,
        stroke: PdfColor,
        stroke_width: f32,
        fill: Option<PdfColor>,
        dashed: bool,
    ) -> Result<(), ReportError> {
        let mut path = PdfPagePathObject::new_rect(
            self.document,
            PdfRect::new_from_values(rect.bottom, rect.left, rect.top, rect.right),
            Some(stroke),
            Some(PdfPoints::new(stroke_width)),
            fill,
        )
        .map_err(compose_error)?;
        if dashed {
            path.set_dash_array(&DASH_PATTERN_PT.map(PdfPoints::new), PdfPoints::ZERO)
                .map_err(compose_error)?;
        }
        self.page
            .objects_mut()
            .add_path_object(path)
            .map_err(compose_error)?;
        Ok(())
    }
}

fn compose_error(source: PdfiumError) -> ReportError {
    ReportError::Compose { source }
}

fn source_pdfium_error(path: &Path, source: PdfiumError) -> ReportError {
    ReportError::Document(DocumentError::Pdfium {
        path: path.to_path_buf(),
        source,
    })
}
