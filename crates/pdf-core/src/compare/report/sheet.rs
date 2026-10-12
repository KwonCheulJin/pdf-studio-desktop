//! 비교 PDF의 장 고르기와 배치 계산. 좌표는 모두 장의 pt(왼쪽 아래 원점)다.

use std::collections::HashMap;

use super::super::model::{ChangeKind, ChangeSide, CompareResult, PageSize, TextBox};
use super::super::options::{display_size, to_display};
use super::{CompareReportOptions, ReportLayout};
use crate::info::PageBox;

/// A4 가로(297 × 210mm)
pub(super) const SHEET_WIDTH_PT: f32 = 841.89;
pub(super) const SHEET_HEIGHT_PT: f32 = 595.28;
/// 장 가장자리 여백
const SHEET_MARGIN_PT: f32 = 24.0;
/// 나란히 놓은 두 칸 사이 간격
const SLOT_GAP_PT: f32 = 16.0;

/// 비교 PDF 한 장에 놓을 쪽(0부터). 보이지 않는 쪽은 `None`이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Sheet {
    pub(super) before: Option<u32>,
    pub(super) after: Option<u32>,
}

/// 쪽 위에 그릴 변경 상자 하나
#[derive(Debug, Clone, Copy)]
pub(super) struct Mark<'r> {
    pub(super) kind: ChangeKind,
    pub(super) needs_review: bool,
    pub(super) bounds: &'r TextBox,
}

/// 숨기지 않은 변경의 상자를 문서·쪽별로 모은 것. 쪽 안에서는 변경 순서다.
pub(super) struct Marks<'r> {
    before: HashMap<u32, Vec<Mark<'r>>>,
    after: HashMap<u32, Vec<Mark<'r>>>,
}

impl<'r> Marks<'r> {
    pub(super) fn collect(result: &'r CompareResult, hidden_kinds: &[ChangeKind]) -> Self {
        let mut marks = Self {
            before: HashMap::new(),
            after: HashMap::new(),
        };
        let visible = result
            .changes
            .iter()
            .filter(|change| !hidden_kinds.contains(&change.kind));
        for change in visible {
            let add = |pages: &mut HashMap<u32, Vec<Mark<'r>>>, side: &'r ChangeSide| {
                for bounds in &side.boxes {
                    pages.entry(bounds.page).or_default().push(Mark {
                        kind: change.kind,
                        needs_review: change.needs_review,
                        bounds,
                    });
                }
            };
            if let Some(before) = &change.before {
                add(&mut marks.before, before);
            }
            if let Some(after) = &change.after {
                add(&mut marks.after, after);
            }
        }
        marks
    }

    pub(super) fn before(&self, page: u32) -> &[Mark<'r>] {
        self.before.get(&page).map_or(&[], Vec::as_slice)
    }

    pub(super) fn after(&self, page: u32) -> &[Mark<'r>] {
        self.after.get(&page).map_or(&[], Vec::as_slice)
    }
}

/// `page_pairs` 행 순서로 장을 고른다. 배치가 한쪽만이면 그쪽 쪽이 없는 행은 뺀다.
/// `changed_pages_only`면 장에 보이는 쪽에 상자가 하나라도 있는 장만 남긴다.
pub(super) fn plan_sheets(
    result: &CompareResult,
    options: &CompareReportOptions,
    marks: &Marks,
) -> Vec<Sheet> {
    result
        .page_pairs
        .iter()
        .map(|&(before, after)| match options.layout {
            ReportLayout::SideBySide => Sheet { before, after },
            ReportLayout::AOnly => Sheet {
                before,
                after: None,
            },
            ReportLayout::BOnly => Sheet {
                before: None,
                after,
            },
        })
        .filter(|sheet| sheet.before.is_some() || sheet.after.is_some())
        .filter(|sheet| {
            !options.changed_pages_only
                || sheet
                    .before
                    .is_some_and(|page| !marks.before(page).is_empty())
                || sheet
                    .after
                    .is_some_and(|page| !marks.after(page).is_empty())
        })
        .collect()
}

/// 배치의 (A 칸, B 칸). 쓰지 않는 쪽은 `None`이다.
pub(super) fn slots(layout: ReportLayout) -> (Option<PageBox>, Option<PageBox>) {
    let full = PageBox {
        left: SHEET_MARGIN_PT,
        bottom: SHEET_MARGIN_PT,
        right: SHEET_WIDTH_PT - SHEET_MARGIN_PT,
        top: SHEET_HEIGHT_PT - SHEET_MARGIN_PT,
    };
    match layout {
        ReportLayout::SideBySide => {
            let half = (full.right - full.left - SLOT_GAP_PT) / 2.0;
            let left = PageBox {
                right: full.left + half,
                ..full
            };
            let right = PageBox {
                left: full.right - half,
                ..full
            };
            (Some(left), Some(right))
        }
        ReportLayout::AOnly => (Some(full), None),
        ReportLayout::BOnly => (None, Some(full)),
    }
}

/// 쪽 하나를 칸에 놓는 변환. 사용자 공간(ADR 0001 §2) → 화면 방향(`/Rotate` 적용, `view_box`
/// 왼쪽 아래가 원점) → 배율 → 칸 안 위치. pdfium이 쪽을 Form XObject로 만들 때 넣는 행렬이 앞의 두
/// 단계와 같으므로, 그 XObject에는 배율과 위치만 더하면 된다.
#[derive(Debug, Clone, Copy)]
pub(super) struct Placement {
    size: PageSize,
    scale: f32,
    left: f32,
    bottom: f32,
}

impl Placement {
    /// 비율을 지켜 칸에 맞춘다. 가로로는 가운데, 세로로는 위에 붙인다(나란히 놓은 두 쪽의 첫 줄이
    /// 같은 높이에서 시작한다).
    pub(super) fn fit(size: &PageSize, slot: PageBox) -> Self {
        let (width, height) = display_size(size);
        let (slot_width, slot_height) = (slot.right - slot.left, slot.top - slot.bottom);
        // 넓이가 0인 보이는 영역(잘못 만든 PDF)은 점으로 놓는다.
        let scale = if width > 0.0 && height > 0.0 {
            (slot_width / width).min(slot_height / height)
        } else {
            0.0
        };
        Self {
            size: *size,
            scale,
            left: slot.left + (slot_width - width * scale) / 2.0,
            bottom: slot.top - height * scale,
        }
    }

    pub(super) fn scale(&self) -> f32 {
        self.scale
    }

    /// 화면 방향 쪽의 왼쪽 아래 모서리가 놓이는 장 좌표
    pub(super) fn origin(&self) -> (f32, f32) {
        (self.left, self.bottom)
    }

    /// 놓인 쪽이 차지하는 사각형
    pub(super) fn frame(&self) -> PageBox {
        let (width, height) = display_size(&self.size);
        PageBox {
            left: self.left,
            bottom: self.bottom,
            right: self.left + width * self.scale,
            top: self.bottom + height * self.scale,
        }
    }

    /// 사용자 공간 상자를 장 좌표로 옮긴다.
    pub(super) fn map(&self, bounds: &TextBox) -> PageBox {
        let display = to_display(bounds, &self.size);
        PageBox {
            left: self.left + display.x * self.scale,
            bottom: self.bottom + display.y * self.scale,
            right: self.left + (display.x + display.w) * self.scale,
            top: self.bottom + (display.y + display.h) * self.scale,
        }
    }
}

/// 두 사각형의 겹친 부분. 겹치지 않으면 `None`이다.
pub(super) fn intersect(first: PageBox, second: PageBox) -> Option<PageBox> {
    let overlap = PageBox {
        left: first.left.max(second.left),
        bottom: first.bottom.max(second.bottom),
        right: first.right.min(second.right),
        top: first.top.min(second.top),
    };
    (overlap.right > overlap.left && overlap.top > overlap.bottom).then_some(overlap)
}

/// 사방으로 `amount`만큼 넓힌다.
pub(super) fn inflate(rect: PageBox, amount: f32) -> PageBox {
    PageBox {
        left: rect.left - amount,
        bottom: rect.bottom - amount,
        right: rect.right + amount,
        top: rect.top + amount,
    }
}
