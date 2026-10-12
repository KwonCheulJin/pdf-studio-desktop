//! B 문서 사본에 변경 주석을 단다. 문서는 메모리에서 고치고 다른 경로로 저장하므로 원본 파일은
//! 읽기만 한다. 쪽 내용 스트림은 다시 만들지 않는다(주석은 `/Annots`에만 더한다).

use std::path::Path;
use std::sync::atomic::AtomicBool;

use pdfium_render::prelude::{
    PdfDocument, PdfPageAnnotationCommon, PdfPageAnnotations, PdfPageContentRegenerationStrategy,
    PdfQuadPoints, PdfRect, Pdfium, PdfiumError,
};

use super::super::model::{Change, ChangeKind, CompareResult, PageSize, Side, TextBox};
use super::compose::ensure_page_in_range;
use super::{ReportError, count, ensure_not_cancelled, kind_colors};
use crate::document::{DocumentError, open_document};
use crate::info::PageBox;

/// 주석 내용 문구. 앱 화면 언어(한국어)로 고정한다.
const INSERT_LABEL: &str = "추가";
const DELETE_LABEL: &str = "삭제";
const BEFORE_LABEL: &str = "변경 전";
const AFTER_LABEL: &str = "변경 후";
const REVIEW_LABEL: &str = "[확인 필요]";
/// 삭제 메모 아이콘 상자 한 변(pt)
const NOTE_SIZE_PT: f32 = 20.0;

/// 쪽 하나에 달 주석
struct Note {
    page: u32,
    shape: NoteShape,
    contents: String,
}

enum NoteShape {
    /// 차이인 추가·변경: B 쪽 상자마다 사각형 하나(QuadPoints), 종류의 채움 색·불투명도
    Highlight { kind: ChangeKind, boxes: PageBoxes },
    /// 확인 필요인 추가·변경: B 쪽 상자 전체를 감싼 테두리, 종류의 선 색
    Square { kind: ChangeKind, rect: PageBox },
    /// 삭제: B에 자리가 없으므로 근사한 위치의 메모 아이콘
    Text { rect: PageBox },
}

/// 한 쪽에 있는 상자들과 그 합집합
struct PageBoxes {
    rects: Vec<PageBox>,
    bounds: PageBox,
}

/// 주석을 단 문서와 단 주석 수를 돌려준다. 저장은 호출자가 한다.
pub(super) fn annotate<'a>(
    pdfium: &'a Pdfium,
    result: &CompareResult,
    after_path: &Path,
    hidden_kinds: &[ChangeKind],
    cancel: &AtomicBool,
) -> Result<(PdfDocument<'a>, u32), ReportError> {
    let document = open_document(pdfium, after_path)?;
    let mut notes: Vec<Note> = result
        .changes
        .iter()
        .filter(|change| !hidden_kinds.contains(&change.kind))
        .flat_map(|change| notes_for(change, result))
        .collect();
    if let Some(last_page) = notes.iter().map(|note| note.page).max() {
        ensure_page_in_range(
            Side::After,
            after_path,
            last_page,
            document.pages().len(),
            result.page_sizes.after.len(),
        )?;
    }
    // 쪽마다 한 번만 연다. 같은 쪽 안에서는 변경 순서를 지킨다.
    notes.sort_by_key(|note| note.page);

    let page_error = |source| {
        ReportError::Document(DocumentError::Pdfium {
            path: after_path.to_path_buf(),
            source,
        })
    };
    for group in notes.chunk_by(|first, second| first.page == second.page) {
        ensure_not_cancelled(cancel)?;
        let Some(first) = group.first() else {
            continue;
        };
        // 쪽 번호는 위에서 pdfium 쪽 수(`i32`) 안인지 확인했다.
        let index = i32::try_from(first.page).unwrap_or(i32::MAX);
        let mut page = document.pages().get(index).map_err(page_error)?;
        // 기본 전략은 바뀔 때마다 원본 쪽의 내용 스트림을 다시 만든다. 주석만 더하므로 끈다.
        page.set_content_regeneration_strategy(PdfPageContentRegenerationStrategy::Manual);
        for note in group {
            add_note(page.annotations_mut(), note).map_err(page_error)?;
        }
    }
    Ok((document, count(notes.len())))
}

/// 변경 하나의 주석들. 추가·변경은 B 상자가 있는 쪽마다 하나, 삭제는 메모 하나다.
fn notes_for(change: &Change, result: &CompareResult) -> Vec<Note> {
    let contents = contents_of(change);
    let Some(after) = &change.after else {
        return delete_note(change, result)
            .map(|(page, rect)| Note {
                page,
                shape: NoteShape::Text { rect },
                contents,
            })
            .into_iter()
            .collect();
    };
    group_by_page(&after.boxes)
        .into_iter()
        .map(|(page, boxes)| {
            let shape = if change.needs_review {
                NoteShape::Square {
                    kind: change.kind,
                    rect: boxes.bounds,
                }
            } else {
                NoteShape::Highlight {
                    kind: change.kind,
                    boxes,
                }
            };
            Note {
                page,
                shape,
                contents: contents.clone(),
            }
        })
        .collect()
}

/// 상자를 처음 나온 쪽 순서로 묶는다. 쪽을 넘는 변경은 쪽마다 한 묶음이다.
fn group_by_page(boxes: &[TextBox]) -> Vec<(u32, PageBoxes)> {
    let mut groups: Vec<(u32, PageBoxes)> = Vec::new();
    for bounds in boxes {
        let rect = PageBox {
            left: bounds.x,
            bottom: bounds.y,
            right: bounds.x + bounds.w,
            top: bounds.y + bounds.h,
        };
        match groups.iter_mut().find(|(page, _)| *page == bounds.page) {
            Some((_, group)) => {
                group.bounds = PageBox {
                    left: group.bounds.left.min(rect.left),
                    bottom: group.bounds.bottom.min(rect.bottom),
                    right: group.bounds.right.max(rect.right),
                    top: group.bounds.top.max(rect.top),
                };
                group.rects.push(rect);
            }
            None => groups.push((
                bounds.page,
                PageBoxes {
                    rects: vec![rect],
                    bounds: rect,
                },
            )),
        }
    }
    groups
}

/// 삭제 메모를 달 B 쪽과 아이콘 상자. 쪽은 삭제된 A 첫 상자 쪽과 같은 행의 B 쪽이고, 그 행에 B 쪽이
/// 없으면 앞 행 중 가장 가까운 B 쪽, 그것도 없으면 뒤 행 중 가장 가까운 B 쪽이다. 위치는 A 첫 상자의
/// 왼쪽 위 모서리를 A `view_box` 안의 비율로 B `view_box`에 옮긴 점이다(근사).
fn delete_note(change: &Change, result: &CompareResult) -> Option<(u32, PageBox)> {
    let first = change.before.as_ref()?.boxes.first()?;
    let row = result
        .page_pairs
        .iter()
        .position(|&(before, _)| before == Some(first.page))?;
    let (earlier, rest) = result.page_pairs.split_at(row);
    let ((_, same_row), later) = rest.split_first()?;
    let after_page = same_row
        .or_else(|| earlier.iter().rev().find_map(|&(_, after)| after))
        .or_else(|| later.iter().find_map(|&(_, after)| after))?;

    let before_view = size_at(&result.page_sizes.before, first.page)?.view_box;
    let after_view = size_at(&result.page_sizes.after, after_page)?.view_box;
    let ratio_x = ratio(
        first.x - before_view.left,
        before_view.right - before_view.left,
    );
    let ratio_y = ratio(
        first.y + first.h - before_view.bottom,
        before_view.top - before_view.bottom,
    );
    let x = after_view.left + ratio_x * (after_view.right - after_view.left);
    let y = after_view.bottom + ratio_y * (after_view.top - after_view.bottom);
    // 아이콘이 보이는 영역 안에 다 들어오게 민다.
    let left = x.min(after_view.right - NOTE_SIZE_PT).max(after_view.left);
    let top = y.max(after_view.bottom + NOTE_SIZE_PT).min(after_view.top);
    Some((
        after_page,
        PageBox {
            left,
            bottom: top - NOTE_SIZE_PT,
            right: left + NOTE_SIZE_PT,
            top,
        },
    ))
}

fn size_at(sizes: &[PageSize], page: u32) -> Option<&PageSize> {
    sizes.get(usize::try_from(page).ok()?)
}

/// `offset / length`를 0~1로 자른다. 길이가 0이면 0이다.
fn ratio(offset: f32, length: f32) -> f32 {
    if length > 0.0 {
        (offset / length).clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// 주석 내용: 변경 전후 글자. 확인 필요 변경은 앞에 표시를 붙인다.
fn contents_of(change: &Change) -> String {
    let before = change.before.as_ref().map(|side| side.text.as_str());
    let after = change.after.as_ref().map(|side| side.text.as_str());
    let body = match (before, after) {
        (Some(before), Some(after)) => {
            format!("{BEFORE_LABEL}: {before}\n{AFTER_LABEL}: {after}")
        }
        (None, Some(after)) => format!("{INSERT_LABEL}: {after}"),
        (Some(before), None) => format!("{DELETE_LABEL}: {before}"),
        (None, None) => String::new(),
    };
    if change.needs_review {
        format!("{REVIEW_LABEL} {body}")
    } else {
        body
    }
}

fn add_note(annotations: &mut PdfPageAnnotations, note: &Note) -> Result<(), PdfiumError> {
    match &note.shape {
        NoteShape::Highlight { kind, boxes } => {
            let mut annotation = annotations.create_highlight_annotation()?;
            annotation.set_bounds(pdf_rect(boxes.bounds))?;
            // 강조 주석의 색은 /C 하나다. 채움 토큰의 색과 불투명도(/CA)를 쓴다.
            let (_, fill) = kind_colors(*kind);
            annotation.set_stroke_color(fill)?;
            for rect in &boxes.rects {
                annotation
                    .attachment_points_mut()
                    .create_attachment_point_at_end(quad_points(*rect))?;
            }
            annotation.set_contents(&note.contents)
        }
        NoteShape::Square { kind, rect } => {
            let mut annotation = annotations.create_square_annotation()?;
            annotation.set_bounds(pdf_rect(*rect))?;
            let (stroke, _) = kind_colors(*kind);
            annotation.set_stroke_color(stroke)?;
            annotation.set_contents(&note.contents)
        }
        NoteShape::Text { rect } => {
            let mut annotation = annotations.create_text_annotation(&note.contents)?;
            annotation.set_bounds(pdf_rect(*rect))?;
            let (stroke, _) = kind_colors(ChangeKind::Delete);
            annotation.set_stroke_color(stroke)
        }
    }
}

/// 강조 사각형의 네 점. 순서는 왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래다. 스펙 문구와 달리
/// 뷰어(Acrobat·pdf.js)와 pdfium의 모양 생성이 이 순서를 가정한다. pdfium-render의
/// `PdfQuadPoints::from_rect`(반시계 방향)로 넣으면 pdfium이 꼬인 사각형을 그려 강조가 거의 안 보인다.
fn quad_points(rect: PageBox) -> PdfQuadPoints {
    PdfQuadPoints::new_from_values(
        rect.left,
        rect.top,
        rect.right,
        rect.top,
        rect.left,
        rect.bottom,
        rect.right,
        rect.bottom,
    )
}

fn pdf_rect(rect: PageBox) -> PdfRect {
    PdfRect::new_from_values(rect.bottom, rect.left, rect.top, rect.right)
}
