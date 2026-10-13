//! 연결선 끝과 모양(계획서 §7.1). 변경마다 A 쪽 끝과 B 쪽 끝을 선 하나(또는 띠 하나)로 잇는다. 이
//! 모듈이 정본이고, 화면(`entities/comparison/model/connector-ends.ts`)이 같은 규칙을 따라 구현한다.
//! 비교 PDF 내보내기(`report/compose.rs`)가 이 결과로 연결선을 그리고, golden은
//! `tests/golden/connector-geometry.connectors.json`이다(E2E가 같은 golden으로 화면 끝점을 맞댄다).
//!
//! - 끝은 사용자 공간 사각형이다(ADR 0001 §2). 글자가 있는 쪽은 첫 상자의 쪽에 있는 상자들의 합집합
//!   (여러 쪽에 걸친 변경도 첫 쪽만), 글자가 없는 쪽은 앵커 막대(너비 0, ADR 0001 §4)다.
//! - 끝점은 이 사각형을 화면·장 좌표로 옮긴 뒤 정한다([`ConnectorEnd::point`]). 그래서 회전·CropBox
//!   원점·배율은 옮기는 변환 하나가 맡는다.
//! - 모양은 글자가 있는 쪽 끝 중 하나라도 [`MAX_LINE_CONNECTOR_LINES`]줄을 넘으면 띠, 아니면 선이다.

use serde::Serialize;

use super::diff::SAME_LINE_MIN_OVERLAP;
use super::model::{Change, ChangeKind, CompareResult, PageSize, Placement, Side, TextBox};
use crate::info::PageBox;

/// 끝 상자가 이 줄 수를 넘으면 선 대신 띠로 잇는다(계획서 §7.1 "합집합 높이 > 2줄").
const MAX_LINE_CONNECTOR_LINES: usize = 2;
const HALF: f32 = 0.5;

/// 연결선 모양
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectorShape {
    /// 끝점 둘을 잇는 선
    Line,
    /// 두 끝의 위·아래 변을 이은 닫힌 띠
    Band,
}

/// 연결선 한쪽 끝
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorEnd {
    /// 사용자 공간 사각형. 앵커는 너비 0인 막대다.
    pub bounds: TextBox,
    /// 그 쪽에 글자가 없어 앵커에 잇는다.
    pub is_anchor: bool,
}

impl ConnectorEnd {
    /// 끝점. `mapped`는 [`Self::bounds`]를 화면·장 좌표로 옮긴 사각형이다(축 방향은 상관없다).
    /// 글자 상자는 거터를 향한 변의 가운데(A는 오른쪽, B는 왼쪽), 앵커는 막대 가운데다. 90·270도 쪽의
    /// 앵커 막대는 옮기면 가로로 눕지만 가운데는 같은 자리다.
    pub(crate) fn point(&self, mapped: PageBox, side: Side) -> (f32, f32) {
        let center_y = (mapped.bottom + mapped.top) * HALF;
        let x = match (self.is_anchor, side) {
            (true, _) => (mapped.left + mapped.right) * HALF,
            (false, Side::Before) => mapped.right,
            (false, Side::After) => mapped.left,
        };
        (x, center_y)
    }
}

/// 변경 하나의 연결선
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connector {
    pub change_id: String,
    pub kind: ChangeKind,
    pub shape: ConnectorShape,
    pub before: ConnectorEnd,
    pub after: ConnectorEnd,
}

/// 결과 순서대로 변경마다 연결선을 만든다.
///
/// - `hidden_kinds`의 변경은 잇지 않는다(화면 필터·내보내기 옵션).
/// - 끝의 쪽이 그 문서의 `page_sizes`에 없으면(쪽이 0개인 문서의 앵커, ADR 0001 §4 "놓을 쪽이 없음")
///   그 변경은 잇지 않는다.
pub fn connectors(result: &CompareResult, hidden_kinds: &[ChangeKind]) -> Vec<Connector> {
    result
        .changes
        .iter()
        .filter(|change| !hidden_kinds.contains(&change.kind))
        .filter_map(|change| connector(change, result))
        .collect()
}

fn connector(change: &Change, result: &CompareResult) -> Option<Connector> {
    let before = connector_end(&change.before, &result.page_sizes.before)?;
    let after = connector_end(&change.after, &result.page_sizes.after)?;
    let lines = [&change.before, &change.after]
        .into_iter()
        .map(|placement| first_page_boxes(placement.boxes()))
        .map(|boxes| line_count(&boxes))
        .max()
        .unwrap_or_default();
    let shape = if lines > MAX_LINE_CONNECTOR_LINES {
        ConnectorShape::Band
    } else {
        ConnectorShape::Line
    };
    Some(Connector {
        change_id: change.id.clone(),
        kind: change.kind,
        shape,
        before,
        after,
    })
}

/// 그 쪽의 끝. 쪽이 `sizes`에 없으면 `None`이다.
fn connector_end(placement: &Placement, sizes: &[PageSize]) -> Option<ConnectorEnd> {
    let end = match placement {
        Placement::Boxes { boxes, .. } => ConnectorEnd {
            bounds: union(&first_page_boxes(boxes))?,
            is_anchor: false,
        },
        &Placement::Anchor { page, x, y, h } => ConnectorEnd {
            bounds: TextBox {
                page,
                x,
                y,
                w: 0.0,
                h,
            },
            is_anchor: true,
        },
    };
    let index = usize::try_from(end.bounds.page).ok()?;
    sizes.get(index).map(|_| end)
}

/// 첫 상자의 쪽에 있는 상자들(텍스트 순서)
fn first_page_boxes(boxes: &[TextBox]) -> Vec<TextBox> {
    let Some(first) = boxes.first() else {
        return Vec::new();
    };
    boxes
        .iter()
        .filter(|bounds| bounds.page == first.page)
        .copied()
        .collect()
}

/// 상자들이 걸친 줄 수. 텍스트 순서로 훑으며 앞 상자와 세로 겹침이 낮은 쪽 높이의
/// [`SAME_LINE_MIN_OVERLAP`]보다 작으면 새 줄이다(ADR 0001 §10 같은 줄 판정의 세로 조건). 가로 간격은
/// 보지 않는다: `Replace`의 글자 diff 상자와 2단의 두 상자는 한 줄에 여럿일 수 있다.
fn line_count(boxes: &[TextBox]) -> usize {
    if boxes.is_empty() {
        return 0;
    }
    1 + boxes
        .windows(2)
        .filter(|pair| !shares_line(&pair[0], &pair[1]))
        .count()
}

fn shares_line(first: &TextBox, second: &TextBox) -> bool {
    let overlap = (first.y + first.h).min(second.y + second.h) - first.y.max(second.y);
    overlap >= SAME_LINE_MIN_OVERLAP * first.h.min(second.h)
}

fn union(boxes: &[TextBox]) -> Option<TextBox> {
    let first = boxes.first()?;
    let edges = boxes.iter().fold(
        PageBox {
            left: first.x,
            bottom: first.y,
            right: first.x + first.w,
            top: first.y + first.h,
        },
        |edges, bounds| PageBox {
            left: edges.left.min(bounds.x),
            bottom: edges.bottom.min(bounds.y),
            right: edges.right.max(bounds.x + bounds.w),
            top: edges.top.max(bounds.y + bounds.h),
        },
    );
    Some(TextBox {
        page: first.page,
        x: edges.left,
        y: edges.bottom,
        w: edges.right - edges.left,
        h: edges.top - edges.bottom,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compare::model::{PageSizes, PageSources};
    use crate::info::PageRotation;

    const A4: PageSize = PageSize {
        view_box: PageBox {
            left: 0.0,
            bottom: 0.0,
            right: 595.0,
            top: 842.0,
        },
        rotation: PageRotation::Degrees0,
    };
    const LINE_HEIGHT: f32 = 10.0;
    const LINE_PITCH: f32 = 22.0;

    fn line_box(page: u32, x: f32, line: u16) -> TextBox {
        TextBox {
            page,
            x,
            y: 700.0 - LINE_PITCH * f32::from(line),
            w: 30.0,
            h: LINE_HEIGHT,
        }
    }

    fn boxes(boxes: Vec<TextBox>) -> Placement {
        Placement::Boxes {
            text: "글자".to_owned(),
            boxes,
            min_confidence: None,
        }
    }

    fn change(kind: ChangeKind, before: Placement, after: Placement) -> Change {
        Change {
            id: format!("{kind:?}"),
            kind,
            before,
            after,
            page_pair: (Some(0), Some(0)),
            needs_review: false,
        }
    }

    fn result(changes: Vec<Change>, pages: usize) -> CompareResult {
        CompareResult {
            changes,
            page_pairs: vec![(Some(0), Some(0))],
            page_sizes: PageSizes {
                before: vec![A4; pages],
                after: vec![A4; pages],
            },
            page_sources: PageSources {
                before: vec![None; pages],
                after: vec![None; pages],
            },
            notices: Vec::new(),
        }
    }

    fn shape_of(change: Change) -> ConnectorShape {
        connectors(&result(vec![change], 1), &[])[0].shape
    }

    /// 여러 쪽에 걸친 변경의 끝은 첫 상자의 쪽 상자들만 합친 사각형이다. 다음 쪽 상자(더 넓고 위에
    /// 있다)를 합치면 끝점이 그 쪽에 없는 자리로 간다.
    #[test]
    fn end_unites_only_the_boxes_on_the_first_page() {
        let first = line_box(0, 300.0, 8);
        let wrapped = line_box(0, 60.0, 9);
        let next_page = TextBox {
            page: 1,
            x: 40.0,
            y: 780.0,
            w: 500.0,
            h: LINE_HEIGHT,
        };
        let spanning = change(
            ChangeKind::Replace,
            boxes(vec![first, wrapped, next_page]),
            boxes(vec![first]),
        );

        let ends = connectors(&result(vec![spanning], 2), &[]);

        assert_eq!(
            ends[0].before.bounds,
            TextBox {
                page: 0,
                x: 60.0,
                y: wrapped.y,
                w: 270.0,
                h: first.y + LINE_HEIGHT - wrapped.y,
            }
        );
    }

    /// 띠는 줄 수로 정한다. 한 줄의 글자 diff 상자 셋과 두 줄은 선이고, 세 줄부터 띠다. 글자가 있는
    /// 쪽 하나만 세 줄이어도(삽입의 B) 띠다.
    #[test]
    fn three_lines_make_a_band_but_two_lines_or_three_boxes_on_one_line_do_not() {
        let one_line = vec![
            line_box(0, 60.0, 0),
            line_box(0, 120.0, 0),
            line_box(0, 180.0, 0),
        ];
        let two_lines = vec![line_box(0, 300.0, 0), line_box(0, 60.0, 1)];
        let three_lines = vec![
            line_box(0, 300.0, 0),
            line_box(0, 60.0, 1),
            line_box(0, 60.0, 2),
        ];
        let anchor = Placement::Anchor {
            page: 0,
            x: 60.0,
            y: 700.0,
            h: LINE_HEIGHT,
        };

        assert_eq!(
            shape_of(change(
                ChangeKind::Replace,
                boxes(one_line.clone()),
                boxes(one_line)
            )),
            ConnectorShape::Line
        );
        assert_eq!(
            shape_of(change(
                ChangeKind::Replace,
                boxes(two_lines.clone()),
                boxes(two_lines)
            )),
            ConnectorShape::Line
        );
        assert_eq!(
            shape_of(change(ChangeKind::Insert, anchor, boxes(three_lines))),
            ConnectorShape::Band
        );
    }

    /// 끝의 쪽이 `page_sizes`에 없는 변경(쪽이 0개인 문서의 앵커)은 잇지 않는다. 쪽이 있으면 같은
    /// 변경을 잇는다.
    #[test]
    fn change_whose_end_page_is_missing_is_not_connected() {
        let nowhere = Placement::Anchor {
            page: 0,
            x: 0.0,
            y: 0.0,
            h: 0.0,
        };
        let insert = change(
            ChangeKind::Insert,
            nowhere,
            boxes(vec![line_box(0, 60.0, 0)]),
        );
        let mut empty_before = result(vec![insert.clone()], 1);
        empty_before.page_sizes.before.clear();

        assert!(connectors(&empty_before, &[]).is_empty());
        assert_eq!(connectors(&result(vec![insert], 1), &[]).len(), 1);
    }
}
