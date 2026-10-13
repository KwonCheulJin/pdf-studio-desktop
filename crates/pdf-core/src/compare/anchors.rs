//! 앵커: 한쪽에만 있는 변경(삽입의 A 쪽, 삭제의 B 쪽)이 반대쪽 문서에서 들어갈 자리. 규칙의 정본은
//! ADR 0001 §4다.
//!
//! - 반대쪽 토큰열에서 변경이 들어갈 위치 바로 앞의 공통 토큰이 있으면 그 토큰 마지막 줄 상자의
//!   오른쪽 끝, 없으면(문서 맨 앞) 바로 뒤 공통 토큰 첫 줄 상자의 왼쪽 끝이다. 앞 토큰이 늘 이기므로
//!   줄·쪽 경계에 들어간 변경은 앞 줄·앞 쪽 끝에 놓인다.
//! - 줄 상자는 토큰 글자 상자를 같은 줄 병합(§10)과 같은 규칙으로 합친 것이고 좌표는 사용자
//!   공간(§2)이다. 기준선은 추출하지 않으므로 줄 상자 아래 모서리로 대신한다.
//! - 반대쪽에 토큰이 하나도 없으면(빈 쪽만 비교) 쪽 짝(`page_pairs`)으로 쪽을 고르고 화면 방향 여백에
//!   둔다.

use super::diff::line_boxes;
use super::model::{PagePair, PageSize, PageSizes, Placement, Side, TextBox};
use super::options::display_size;
use super::tokenize::Token;
use crate::info::PageRotation;

/// 빈 쪽 앵커를 쪽 가장자리에서 들여놓는 거리(pt). 워드 기본 여백(72pt)이라 본문 첫 줄이 놓일 자리다.
/// 쪽이 이 값의 두 배보다 작으면 그 방향 가운데에 둔다.
const EMPTY_PAGE_ANCHOR_INSET_PT: f32 = 72.0;
const HALF: f32 = 0.5;
/// 놓을 쪽이 없을 때(반대쪽 비교 범위에 쪽이 하나도 없다: 쪽이 0개인 PDF)의 앵커. 쪽 0은 그
/// 문서의 `page_sizes`에 없으므로 화면·내보내기는 그리지 않는다.
const NOWHERE: Placement = Placement::Anchor {
    page: 0,
    x: 0.0,
    y: 0.0,
    h: 0.0,
};

/// 비교에 넣은 쪽. 반대쪽에 토큰이 하나도 없을 때 앵커를 놓을 쪽을 고르는 데 쓴다(ADR 0001 §4).
#[derive(Debug, Clone, Copy)]
pub struct ComparedPages<'a> {
    /// A 비교 범위의 쪽 번호(0부터, 오름차순, 토큰이 없는 쪽 포함). `pair_pages`의 범위 인자와 같다.
    pub before: &'a [u32],
    /// B 비교 범위의 쪽 번호
    pub after: &'a [u32],
    /// 두 문서 모든 쪽의 크기(색인 = 쪽 번호)
    pub sizes: &'a PageSizes,
}

/// 빈 쪽 앵커를 쪽의 어느 여백에 두나(화면 방향)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Margin {
    /// 위 여백: 막대 위 끝이 화면 위에서 [`EMPTY_PAGE_ANCHOR_INSET_PT`] 아래
    Top,
    /// 아래 여백: 막대 아래 끝이 화면 아래에서 [`EMPTY_PAGE_ANCHOR_INSET_PT`] 위
    Bottom,
}

/// 한쪽에만 있는 변경의 반대쪽 앵커.
///
/// - `side`: 앵커를 놓을 문서(삽입이면 [`Side::Before`])이고 `tokens`는 그 문서의 토큰열,
///   `position`은 변경이 그 토큰열에 들어갈 자리(변경 구간의 시작 = 끝)다.
/// - `present`: 변경 글자가 있는 쪽의 상자. 반대쪽에 토큰이 없을 때 쪽과 막대 높이를 정한다.
/// - `rows`: 반대쪽에 토큰이 없을 때만 부르는 쪽 짝(결과의 `page_pairs`와 같은 값).
pub(super) fn anchor(
    side: Side,
    tokens: &[Token],
    position: usize,
    present: &[TextBox],
    pages: &ComparedPages,
    rows: impl FnOnce() -> Vec<PagePair>,
) -> Placement {
    let previous_line = position
        .checked_sub(1)
        .and_then(|index| tokens.get(index))
        .and_then(|token| line_boxes(&token.key_boxes).last().copied());
    if let Some(line) = previous_line {
        return caret(line.page, line.x + line.w, line.y, line.h);
    }
    let next_line = tokens
        .get(position)
        .and_then(|token| line_boxes(&token.key_boxes).first().copied());
    if let Some(line) = next_line {
        return caret(line.page, line.x, line.y, line.h);
    }
    empty_side_anchor(side, present, pages.sizes, &rows())
}

/// 반대쪽에 토큰이 없을 때의 앵커. 변경 첫 상자의 쪽과 같은 행의 반대쪽 쪽 위 여백, 그 행에 반대쪽
/// 쪽이 없으면 앞 행 중 가장 가까운 반대쪽 쪽의 아래 여백, 그것도 없으면 뒤 행 중 가장 가까운 반대쪽
/// 쪽의 위 여백이다. 막대 높이는 변경 첫 상자 높이다. 놓을 쪽이 없으면 [`NOWHERE`]다.
fn empty_side_anchor(
    side: Side,
    present: &[TextBox],
    sizes: &PageSizes,
    rows: &[PagePair],
) -> Placement {
    let (present_side, opposite_sizes) = match side {
        Side::Before => (Side::After, &sizes.before),
        Side::After => (Side::Before, &sizes.after),
    };
    let opposite_of = move |pair: &PagePair| page_of(side, pair);
    let present_of = move |pair: &PagePair| page_of(present_side, pair);
    let first = present.first();
    let height = first.map_or(0.0, |bounds| bounds.h);
    let target = first
        .and_then(|bounds| {
            rows.iter()
                .position(|pair| present_of(pair) == Some(bounds.page))
        })
        .and_then(|row| {
            let (earlier, rest) = rows.split_at(row);
            let (same, later) = rest.split_first()?;
            opposite_of(same)
                .map(|page| (page, Margin::Top))
                .or_else(|| {
                    earlier
                        .iter()
                        .rev()
                        .find_map(opposite_of)
                        .map(|page| (page, Margin::Bottom))
                })
                .or_else(|| {
                    later
                        .iter()
                        .find_map(opposite_of)
                        .map(|page| (page, Margin::Top))
                })
        })
        .and_then(|(page, margin)| {
            let size = opposite_sizes.get(usize::try_from(page).ok()?)?;
            Some(margin_anchor(page, size, margin, height))
        });
    target.unwrap_or(NOWHERE)
}

/// 행에서 `side` 문서의 쪽
fn page_of(side: Side, pair: &PagePair) -> Option<u32> {
    match side {
        Side::Before => pair.0,
        Side::After => pair.1,
    }
}

/// 쪽의 화면 방향 왼쪽·위(또는 아래) 여백에 둔 높이 `height`의 막대. 막대 가운데가 화면에서 왼쪽
/// 가장자리로부터 들인 거리, 위(아래) 가장자리로부터 들인 거리 + 높이의 반에 온다. 사용자 공간 막대는
/// 세로라 `/Rotate` 90·270 쪽에서는 화면에서 가로로 놓이지만 가운데는 같다.
fn margin_anchor(page: u32, size: &PageSize, margin: Margin, height: f32) -> Placement {
    let (display_width, display_height) = display_size(size);
    let inset_x = EMPTY_PAGE_ANCHOR_INSET_PT.min(display_width * HALF);
    let inset_y = EMPTY_PAGE_ANCHOR_INSET_PT.min(display_height * HALF);
    let center_y = match margin {
        Margin::Top => display_height - inset_y - height * HALF,
        Margin::Bottom => inset_y + height * HALF,
    };
    let (x, y) = from_display(inset_x, center_y, size);
    caret(page, x, y - height * HALF, height)
}

/// 화면 방향 점(`view_box` 왼쪽 아래 원점, y 위쪽)을 절대 사용자 공간 점으로 되돌린다.
/// `options::to_display`의 역변환이다(`/Rotate`는 시계 방향).
fn from_display(display_x: f32, display_y: f32, size: &PageSize) -> (f32, f32) {
    let view = size.view_box;
    let (width, height) = (view.right - view.left, view.top - view.bottom);
    let (x, y) = match size.rotation {
        PageRotation::Degrees0 => (display_x, display_y),
        PageRotation::Degrees90 => (width - display_y, display_x),
        PageRotation::Degrees180 => (width - display_x, height - display_y),
        PageRotation::Degrees270 => (display_y, height - display_x),
    };
    (view.left + x, view.bottom + y)
}

fn caret(page: u32, x: f32, y: f32, h: f32) -> Placement {
    Placement::Anchor { page, x, y, h }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::info::PageBox;

    const INSERTED_HEIGHT: f32 = 10.0;

    fn inserted(page: u32) -> Vec<TextBox> {
        vec![TextBox {
            page,
            x: 100.0,
            y: 500.0,
            w: 40.0,
            h: INSERTED_HEIGHT,
        }]
    }

    fn size(view_box: PageBox, rotation: PageRotation) -> PageSize {
        PageSize { view_box, rotation }
    }

    /// 반대쪽 토큰이 없는 삽입의 A 앵커. 기대값은 화면 방향 그림을 손으로 셈한 것이다.
    fn anchor_of(before_sizes: Vec<PageSize>, rows: &[PagePair], page: u32) -> Placement {
        let sizes = PageSizes {
            before: before_sizes,
            after: vec![size(
                PageBox {
                    left: 0.0,
                    bottom: 0.0,
                    right: 595.0,
                    top: 842.0,
                },
                PageRotation::Degrees0,
            )],
        };
        empty_side_anchor(Side::Before, &inserted(page), &sizes, rows)
    }

    /// `/Rotate 90` + CropBox 오프셋 쪽의 위 여백: 화면 위는 사용자 공간 왼쪽 가장자리다. 화면에서
    /// 왼쪽 72pt·위 72pt + 막대 반 높이 아래가 막대 가운데이므로 사용자 공간 x = left + 72 + 5,
    /// 가운데 y = bottom + 72 → 막대 아래 끝 y = bottom + 67이다.
    #[test]
    fn empty_page_anchor_follows_the_displayed_top_of_a_rotated_page() {
        let rotated = size(
            PageBox {
                left: 60.0,
                bottom: 80.0,
                right: 560.0,
                top: 720.0,
            },
            PageRotation::Degrees90,
        );

        let placement = anchor_of(vec![rotated], &[(Some(0), Some(0))], 0);

        assert_eq!(
            placement,
            Placement::Anchor {
                page: 0,
                x: 137.0,
                y: 147.0,
                h: INSERTED_HEIGHT,
            }
        );
    }

    /// 쪽 짝이 없으면 앞 행 중 가장 가까운 A 쪽의 아래 여백, 앞 행에 없을 때만 뒤 행 중 가장 가까운 A
    /// 쪽의 위 여백이다. 행은 A가 빈 쪽뿐일 때 `pair_pages`가 실제로 내는 모양이다(빈 쪽끼리 먼저 짝,
    /// 남은 쪽 수가 다르면 A만 있는 행이 먼저). 쪽이 들인 거리의 두 배보다 작으면 가운데에 둔다(가로
    /// 100pt → x = 50).
    #[test]
    fn unpaired_page_anchors_on_the_nearest_earlier_page_bottom_before_any_later_page() {
        let small = size(
            PageBox {
                left: 0.0,
                bottom: 0.0,
                right: 100.0,
                top: 400.0,
            },
            PageRotation::Degrees0,
        );
        let sizes = vec![small; 3];
        let bottom = |page| Placement::Anchor {
            page,
            x: 50.0,
            y: 72.0,
            h: INSERTED_HEIGHT,
        };
        let top = |page| Placement::Anchor {
            page,
            x: 50.0,
            y: 400.0 - 72.0 - INSERTED_HEIGHT,
            h: INSERTED_HEIGHT,
        };

        // A [빈, 빈] ↔ B [글자]: 짝 없이 A만 있는 행 둘 뒤에 B 행
        let nearest = anchor_of(
            sizes.clone(),
            &[(Some(0), None), (Some(1), None), (None, Some(0))],
            0,
        );
        // A [빈, 빈, 빈] ↔ B [빈, 글자, 글자, 빈]: 앞에도 뒤에도 A 쪽이 있다
        let earlier_first = anchor_of(
            sizes.clone(),
            &[
                (Some(0), Some(0)),
                (None, Some(1)),
                (None, Some(2)),
                (Some(1), Some(3)),
                (Some(2), None),
            ],
            1,
        );
        // A [빈] ↔ B [글자, 빈]: 앞 행에 A 쪽이 없다
        let later = anchor_of(sizes, &[(None, Some(0)), (Some(0), Some(1))], 0);

        assert_eq!(nearest, bottom(1));
        assert_eq!(earlier_first, bottom(0));
        assert_eq!(later, top(0));
    }
}
