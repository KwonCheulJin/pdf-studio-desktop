//! 비교 PDF 문서를 pdfium으로 만든다. 원본 쪽은 Form XObject로 가져와 내용 스트림·리소스를 그대로
//! 쓰므로 글자는 벡터로 남고 원본 파일은 읽기만 한다.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use pdfium_render::prelude::{
    PdfColor, PdfDocument, PdfPage, PdfPageContentRegenerationStrategy, PdfPageObjectCommon,
    PdfPageObjectLineCap, PdfPageObjectsCommon, PdfPagePaperSize, PdfPagePathObject, PdfPoints,
    PdfRect, Pdfium, PdfiumError,
};

use super::super::connectors::{Connector, ConnectorShape, connectors, exit_point};
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
pub(super) const BORDER_COLOR: PdfColor = PdfColor::new(0xdf, 0xdf, 0xe5, 0xff);
const BORDER_WIDTH_PT: f32 = 0.75;
/// 차이 상자 선 굵기. 확인 필요 상자는 채우지 않는 대신 선을 굵게 한다.
const BOX_STROKE_WIDTH_PT: f32 = 0.75;
const REVIEW_STROKE_WIDTH_PT: f32 = 1.5;
/// 글자 tight 상자(ADR 0001 §8)에 붙지 않도록 장 좌표에서 사방으로 넓히는 양
const BOX_PADDING_PT: f32 = 1.0;
/// 점선 무늬(선, 빈칸 길이). 빈 쪽 자리와 변경(`Replace`) 상자에 쓴다. 토큰 문서가 변경을 점선으로
/// 구분하므로(색각 이상에서 삭제 주황과 변경 노랑을 가린다) 화면과 같은 구분을 둔다.
const DASH_PATTERN_PT: [f32; 2] = [3.0, 2.0];
/// 연결선 선 굵기. 장은 쪽을 약 0.65배로 놓으므로 화면 선(1.5px, 배율 100%에서 약 1.1pt)보다 조금
/// 가늘게 둔다. 색은 종류의 선 색 토큰이다(토큰 문서 §6.6).
const CONNECTOR_STROKE_WIDTH_PT: f32 = 1.0;
/// 띠(2줄 넘는 변경)의 테두리 굵기. 채움은 종류의 `-fill` 토큰(알파 그대로)이다.
const BAND_STROKE_WIDTH_PT: f32 = 0.5;
/// 연결선 끝 줄 표시(Step 28-d)의 테두리 굵기와 채움 알파를 나누는 값. 채움은 종류 `-fill` 토큰의 반
/// 알파라 그 위의 변경 상자(`-fill` 그대로)가 더 진하게 보인다(화면 `ROW_BAND_STYLE.FILL_OPACITY`와 같다).
pub(super) const ROW_STROKE_WIDTH_PT: f32 = 0.5;
const ROW_FILL_ALPHA_DIVISOR: u8 = 2;
/// 한 장의 연결선(변경 하나에 하나)이 이보다 많으면 그 장에는 연결선을 그리지 않는다(선이 엉켜 읽을 수
/// 없다, 계획서 §7.1).
pub(super) const MAX_SHEET_CONNECTORS: usize = 40;
const HALF: f32 = 0.5;

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
    let connectors = sheet_connectors(result, options);

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
        let on_sheet = connectors_on_sheet(&connectors, &placed_before, &placed_after);
        let mut canvas = Canvas {
            document: &mut document,
            page: &mut page,
        };
        for (side, placed, page_marks) in [
            (
                Side::Before,
                &placed_before,
                sheet.before.map(|page| marks.before(page)),
            ),
            (
                Side::After,
                &placed_after,
                sheet.after.map(|page| marks.after(page)),
            ),
        ] {
            let Some(placed) = placed else {
                continue;
            };
            canvas.place_page(placed)?;
            canvas.frame(placed.placement.frame(), false)?;
            // 줄 표시를 변경 상자보다 먼저 그려 상자가 그 위에 보이게 한다.
            for connector in &on_sheet {
                canvas.row_band(connector.kind, connector.end(side).row, &placed.placement)?;
            }
            if options.draw_boxes {
                for mark in page_marks.unwrap_or_default() {
                    canvas.mark(mark, &placed.placement)?;
                }
            }
        }
        if options.layout == ReportLayout::SideBySide {
            canvas.empty_slot(placed_before.as_ref(), placed_after.as_ref())?;
        }
        if let (Some(before_page), Some(after_page), Some(before_slot), Some(after_slot)) =
            (&placed_before, &placed_after, before_slot, after_slot)
        {
            let gutter = Gutter {
                left: before_slot.right,
                right: after_slot.left,
            };
            for connector in &on_sheet {
                canvas.connector(
                    connector,
                    &before_page.placement,
                    &after_page.placement,
                    &gutter,
                )?;
            }
        }
        page.regenerate_content().map_err(compose_error)?;
    }
    Ok(document)
}

/// 그릴 연결선(계획서 §7.1, 화면과 같은 `connectors`). 나란히 배치에 색 상자를 넣을 때만 그린다(상자가
/// 없으면 이을 곳이 없다). 숨긴 종류는 상자처럼 뺀다. 장에는 두 끝이 모두 그 장의 두 쪽에 있는 변경만
/// 그린다(다른 장으로 넘어가는 선은 그릴 곳이 없다).
fn sheet_connectors(result: &CompareResult, options: &CompareReportOptions) -> Vec<Connector> {
    if options.layout != ReportLayout::SideBySide || !options.draw_boxes {
        return Vec::new();
    }
    connectors(result, &options.hidden_kinds)
}

/// 장에 그릴 연결선: 두 끝이 모두 그 장의 두 쪽(A 칸 쪽, B 칸 쪽)에 있는 변경. 두 쪽이 다 놓이지 않았거나
/// [`MAX_SHEET_CONNECTORS`]개를 넘으면 하나도 그리지 않는다(줄 표시도 연결선의 일부라 함께 뺀다).
fn connectors_on_sheet<'c>(
    connectors: &'c [Connector],
    before: &Option<PlacedPage>,
    after: &Option<PlacedPage>,
) -> Vec<&'c Connector> {
    let (Some(before), Some(after)) = (before, after) else {
        return Vec::new();
    };
    let on_sheet: Vec<&Connector> = connectors
        .iter()
        .filter(|connector| {
            connector.before.bounds.page == before.page && connector.after.bounds.page == after.page
        })
        .collect();
    if on_sheet.len() > MAX_SHEET_CONNECTORS {
        return Vec::new();
    }
    on_sheet
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

    /// 연결선 끝의 줄 표시(계획서 §7.1 Step 28-d): 놓인 쪽 너비 전체, 끝 사각형의 세로 범위. 종류 선 색
    /// 얇은 테두리 + 종류 `-fill` 반 알파 채움이다. `row`는 화면 방향 pt(`ConnectorEnd::row`).
    fn row_band(
        &mut self,
        kind: ChangeKind,
        row: PageBox,
        placement: &Placement,
    ) -> Result<(), ReportError> {
        let (stroke, fill) = kind_colors(kind);
        let fill = PdfColor::new(
            fill.red(),
            fill.green(),
            fill.blue(),
            fill.alpha() / ROW_FILL_ALPHA_DIVISOR,
        );
        self.rect(
            placement.map_display(row),
            stroke,
            ROW_STROKE_WIDTH_PT,
            Some(fill),
            false,
        )
    }

    /// 변경 하나를 잇는다(계획서 §7.1, 화면과 같은 모양). 선은 A 줄 표시의 거터 쪽 변(A 쪽 오른쪽 끝)
    /// 세로 가운데 → A 칸 오른쪽 끝까지 수평 → 두 칸 사이 3차 베지어 → B 칸 왼쪽 끝 → B 쪽 왼쪽 끝까지
    /// 수평이고, 띠는 두 줄 표시의 위 변과 아래 변을 같은 모양으로 이은 닫힌 경로다. 줄 표시를 장 좌표로
    /// 옮긴 뒤 나가는 점을 정한다.
    fn connector(
        &mut self,
        connector: &Connector,
        before: &Placement,
        after: &Placement,
        gutter: &Gutter,
    ) -> Result<(), ReportError> {
        let before_row = before.map_display(connector.before.row);
        let after_row = after.map_display(connector.after.row);
        let (start_x, start_y) = exit_point(before_row, Side::Before);
        let (end_x, end_y) = exit_point(after_row, Side::After);
        let (stroke, fill) = kind_colors(connector.kind);
        let path = match connector.shape {
            ConnectorShape::Line => {
                let mut path =
                    self.path_from(start_x, start_y, stroke, CONNECTOR_STROKE_WIDTH_PT, None)?;
                gutter
                    .line(&mut path, (start_x, start_y), (end_x, end_y))
                    .map_err(compose_error)?;
                path
            }
            ConnectorShape::Band => {
                let mut path = self.path_from(
                    start_x,
                    before_row.top,
                    stroke,
                    BAND_STROKE_WIDTH_PT,
                    Some(fill),
                )?;
                let before_edge = BandEdge {
                    x: start_x,
                    top: before_row.top,
                    bottom: before_row.bottom,
                };
                let after_edge = BandEdge {
                    x: end_x,
                    top: after_row.top,
                    bottom: after_row.bottom,
                };
                gutter
                    .band(&mut path, before_edge, after_edge)
                    .map_err(compose_error)?;
                path
            }
        };
        self.page
            .objects_mut()
            .add_path_object(path)
            .map_err(compose_error)?;
        Ok(())
    }

    fn path_from(
        &self,
        x: f32,
        y: f32,
        stroke: PdfColor,
        stroke_width: f32,
        fill: Option<PdfColor>,
    ) -> Result<PdfPagePathObject<'a>, ReportError> {
        PdfPagePathObject::new(
            self.document,
            PdfPoints::new(x),
            PdfPoints::new(y),
            Some(stroke),
            Some(PdfPoints::new(stroke_width)),
            fill,
        )
        .map_err(compose_error)
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

/// 두 칸 사이(A 칸 오른쪽 끝 → B 칸 왼쪽 끝, 화면의 거터). 연결선은 이 구간을 3차 베지어로 건넌다:
/// 제어점은 각 끝에서 구간 반만큼 수평으로 나간 점이라 양끝에서 수평으로 들고 난다(화면과 같은 식).
struct Gutter {
    left: f32,
    right: f32,
}

/// 띠 한쪽 끝의 변: 끝점 x와 위·아래(장 좌표, y 위쪽)
#[derive(Debug, Clone, Copy)]
struct BandEdge {
    x: f32,
    top: f32,
    bottom: f32,
}

impl Gutter {
    /// 지금 점(A 쪽 오른쪽 끝)에서 A 칸 끝까지 수평 → 건너기 → B 칸 끝에서 B 쪽 왼쪽 끝까지 수평. 끝은
    /// 둥글다.
    fn line(
        &self,
        path: &mut PdfPagePathObject,
        start: (f32, f32),
        end: (f32, f32),
    ) -> Result<(), PdfiumError> {
        path.line_to(PdfPoints::new(self.left), PdfPoints::new(start.1))?;
        self.cross(path, (self.left, start.1), (self.right, end.1))?;
        path.line_to(PdfPoints::new(end.0), PdfPoints::new(end.1))?;
        path.set_line_cap(PdfPageObjectLineCap::Round)
    }

    /// 지금 점(A 줄 표시 위 변의 쪽 끝)에서 위 변을 B로 건너고, B 쪽 끝을 내려와 아래 변을 A로 돌아와
    /// 닫는다.
    fn band(
        &self,
        path: &mut PdfPagePathObject,
        before: BandEdge,
        after: BandEdge,
    ) -> Result<(), PdfiumError> {
        path.line_to(PdfPoints::new(self.left), PdfPoints::new(before.top))?;
        self.cross(path, (self.left, before.top), (self.right, after.top))?;
        path.line_to(PdfPoints::new(after.x), PdfPoints::new(after.top))?;
        path.line_to(PdfPoints::new(after.x), PdfPoints::new(after.bottom))?;
        path.line_to(PdfPoints::new(self.right), PdfPoints::new(after.bottom))?;
        self.cross(path, (self.right, after.bottom), (self.left, before.bottom))?;
        path.line_to(PdfPoints::new(before.x), PdfPoints::new(before.bottom))?;
        path.close_path()
    }

    /// 지금 점 `from`에서 `to`까지(둘 다 칸 사이 양끝 중 하나). 제어점은 각 끝에서 반 폭만큼 상대 끝 쪽.
    fn cross(
        &self,
        path: &mut PdfPagePathObject,
        from: (f32, f32),
        to: (f32, f32),
    ) -> Result<(), PdfiumError> {
        let half = (to.0 - from.0) * HALF;
        path.bezier_to(
            PdfPoints::new(to.0),
            PdfPoints::new(to.1),
            PdfPoints::new(from.0 + half),
            PdfPoints::new(from.1),
            PdfPoints::new(to.0 - half),
            PdfPoints::new(to.1),
        )
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
