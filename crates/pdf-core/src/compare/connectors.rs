//! 연결선 묶기(계획서 §7.1). A 변경 상자와 B 대응 상자를 거터 곡선으로 이을 때 가까운 변경 여러
//! 개를 선 하나(묶음)로 묶는다. 이 모듈이 정본이고, 화면(`entities/comparison/model/connector-stems.ts`)이
//! 같은 규칙을 따라 구현한다. golden은 `tests/golden/connectors.stems.json`이고 E2E가 같은 golden으로
//! 화면 연결선 끝점을 맞댄다.
//!
//! - 계산은 모두 PDF pt이고, 순서·간격은 화면 방향 좌표(`/Rotate` 적용, `view_box` 왼쪽 아래 원점,
//!   y 위쪽)로 본다. 확대 배율과 상관없다.
//! - 값은 결과 모델 그대로 `f32`로 계산한다. 화면은 같은 값을 `Math.fround`로 받아 연산마다
//!   `Math.fround`를 씌워 같은 결과를 낸다(묶음 경계가 화면과 내보내기에서 같다).

use std::cmp::Ordering;

use serde::Serialize;

use super::model::{Change, ChangeKind, CompareResult, PageSize, Placement, TextBox};
use crate::info::{PageBox, PageRotation};

/// 이웃한 두 변경을 한 묶음으로 붙이는 세로 간격의 상한(pt). 양쪽(A·B) 모두 이 값 이하여야 한다.
/// 계획서 §7.1의 시작값이고, 줄 간격 22pt·12pt 글자 픽스처에서 붙은 줄(간격 약 13pt)은 묶고 한 줄을
/// 건너뛴 줄(약 35pt)은 가른다.
const CONNECTOR_GAP_PT: f32 = 20.0;

/// 선 하나로 이을 변경 묶음
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorStem {
    /// 묶음 안 변경. A 읽는 순서다.
    pub change_ids: Vec<String>,
    /// 끝점 상자: 묶음 안 변경들이 그 행의 A 쪽에 둔 상자의 합집합(사용자 공간)
    pub before: TextBox,
    /// 같은 변경들이 그 행의 B 쪽에 둔 상자의 합집합
    pub after: TextBox,
}

/// 행 하나(A 쪽과 B 쪽이 모두 있는 `page_pairs` 행)의 묶음
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowConnectors {
    /// (A 쪽, B 쪽)
    pub pages: (u32, u32),
    /// A 읽는 순서
    pub stems: Vec<ConnectorStem>,
}

/// 결과의 행마다 연결선 묶음을 만든다. 묶음이 없는 행은 넣지 않는다.
///
/// - 잇는 변경: A·B 쪽이 모두 있고(`Replace`), 첫 상자의 두 쪽(`page_pair`)이 그 행의 두 쪽이며,
///   `hidden_kinds`에 들지 않은 변경. 숨긴 변경을 남겨 두면 빈 자리를 가로질러 묶음이 생긴다.
/// - 변경마다 그 행의 쪽에 둔 상자들의 합집합 하나를 쓴다(줄바꿈으로 상자가 여럿일 수 있다).
/// - A 읽는 순서(위쪽 모서리 내림차순 → 왼쪽 오름차순 → 결과 안 순번)로 훑으며, 앞 변경과의 세로
///   간격이 A·B 모두 [`CONNECTOR_GAP_PT`] 이하이고 B 읽는 순서의 순위가 앞 변경의 순위 + 1일 때만
///   앞 묶음에 붙인다.
pub fn connector_stems(result: &CompareResult, hidden_kinds: &[ChangeKind]) -> Vec<RowConnectors> {
    result
        .page_pairs
        .iter()
        .filter_map(|&pair| {
            let (Some(before_page), Some(after_page)) = pair else {
                return None;
            };
            let row = Row {
                before: RowPage::of(&result.page_sizes.before, before_page)?,
                after: RowPage::of(&result.page_sizes.after, after_page)?,
            };
            let visible = result
                .changes
                .iter()
                .filter(|change| !hidden_kinds.contains(&change.kind));
            let stems = row.stems(visible);
            (!stems.is_empty()).then_some(RowConnectors {
                pages: (before_page, after_page),
                stems,
            })
        })
        .collect()
}

/// 행의 한쪽 쪽과 그 크기
#[derive(Debug, Clone, Copy)]
struct RowPage<'r> {
    page: u32,
    size: &'r PageSize,
}

impl<'r> RowPage<'r> {
    fn of(sizes: &'r [PageSize], page: u32) -> Option<Self> {
        let size = sizes.get(usize::try_from(page).ok()?)?;
        Some(Self { page, size })
    }

    /// 그 쪽에 있는 상자들의 합집합과 화면 방향 가장자리. 그 쪽에 상자가 없으면(앵커 포함) `None`이다.
    fn place(&self, side: &Placement) -> Option<Placed> {
        let bounds = side
            .boxes()
            .iter()
            .filter(|bounds| bounds.page == self.page)
            .map(edges)
            .reduce(union)?;
        Some(Placed {
            bounds,
            screen: screen_edges(&bounds, self.size),
        })
    }
}

#[derive(Debug, Clone, Copy)]
struct Row<'r> {
    before: RowPage<'r>,
    after: RowPage<'r>,
}

impl Row<'_> {
    fn stems<'c>(&self, changes: impl Iterator<Item = &'c Change>) -> Vec<ConnectorStem> {
        let linked: Vec<Linked> = changes
            .enumerate()
            .filter_map(|(index, change)| self.link(index, change))
            .collect();
        let before_order = reading_order(&linked, |link| link.before.screen);
        let mut after_rank = vec![0; linked.len()];
        for (rank, &position) in reading_order(&linked, |link| link.after.screen)
            .iter()
            .enumerate()
        {
            after_rank[position] = rank;
        }

        let mut stems: Vec<Building> = Vec::new();
        let mut previous: Option<usize> = None;
        for position in before_order {
            let current = &linked[position];
            let joins = previous.is_some_and(|previous| {
                let earlier = &linked[previous];
                after_rank[position] == after_rank[previous] + 1
                    && is_near(&earlier.before.screen, &current.before.screen)
                    && is_near(&earlier.after.screen, &current.after.screen)
            });
            match stems.last_mut() {
                Some(stem) if joins => {
                    stem.change_ids.push(current.id.to_owned());
                    stem.before = union(stem.before, current.before.bounds);
                    stem.after = union(stem.after, current.after.bounds);
                }
                _ => stems.push(Building {
                    change_ids: vec![current.id.to_owned()],
                    before: current.before.bounds,
                    after: current.after.bounds,
                }),
            }
            previous = Some(position);
        }
        stems
            .into_iter()
            .map(|stem| ConnectorStem {
                change_ids: stem.change_ids,
                before: text_box(self.before.page, &stem.before),
                after: text_box(self.after.page, &stem.after),
            })
            .collect()
    }

    /// 이 행에서 이을 수 있는 변경이면 두 쪽의 상자 합집합을 둔다.
    fn link<'c>(&self, index: usize, change: &'c Change) -> Option<Linked<'c>> {
        if change.page_pair != (Some(self.before.page), Some(self.after.page)) {
            return None;
        }
        Some(Linked {
            index,
            id: &change.id,
            before: self.before.place(&change.before)?,
            after: self.after.place(&change.after)?,
        })
    }
}

/// 만드는 중인 묶음. 상자는 가장자리로 두고 끝에서 한 번만 `TextBox`로 바꾼다(화면과 같은 반올림).
struct Building {
    change_ids: Vec<String>,
    before: PageBox,
    after: PageBox,
}

/// 이을 변경 하나
struct Linked<'c> {
    /// 결과 안 순번(읽는 순서 동률을 가른다)
    index: usize,
    id: &'c str,
    before: Placed,
    after: Placed,
}

/// 한 쪽의 상자 합집합(사용자 공간)과 그 화면 방향 가장자리
#[derive(Debug, Clone, Copy)]
struct Placed {
    bounds: PageBox,
    screen: ScreenEdges,
}

/// 화면 방향 좌표(`view_box` 왼쪽 아래 원점, y 위쪽)의 가장자리. 순서·간격에 쓰는 것만 둔다.
#[derive(Debug, Clone, Copy)]
struct ScreenEdges {
    left: f32,
    bottom: f32,
    top: f32,
}

/// 읽는 순서로 늘어놓은 `linked`의 위치들
fn reading_order(linked: &[Linked], screen: impl Fn(&Linked) -> ScreenEdges) -> Vec<usize> {
    let mut order: Vec<usize> = (0..linked.len()).collect();
    order.sort_by(|&first, &second| {
        let (first_link, second_link) = (&linked[first], &linked[second]);
        let (first_edges, second_edges) = (screen(first_link), screen(second_link));
        compare_values(second_edges.top, first_edges.top)
            .then(compare_values(first_edges.left, second_edges.left))
            .then(first_link.index.cmp(&second_link.index))
    });
    order
}

/// 상자 값은 유한하다(추출이 pdfium 좌표를 그대로 쓴다). `-0`과 `0`은 같게 본다(화면 `<`와 같다).
fn compare_values(first: f32, second: f32) -> Ordering {
    first.partial_cmp(&second).unwrap_or(Ordering::Equal)
}

/// 위 변경의 아래 끝과 아래 변경의 위 끝 사이가 [`CONNECTOR_GAP_PT`] 이하인가(겹치면 음수라 붙는다)
fn is_near(earlier: &ScreenEdges, current: &ScreenEdges) -> bool {
    earlier.bottom - current.top <= CONNECTOR_GAP_PT
}

/// 사용자 공간 상자를 화면 방향 가장자리로 옮긴다. `/Rotate`는 시계 방향이라 90이면 사용자 공간 왼쪽
/// 가장자리가 화면 위, 180이면 아래쪽 가장자리가 화면 위, 270이면 오른쪽 가장자리가 화면 위다.
fn screen_edges(bounds: &PageBox, size: &PageSize) -> ScreenEdges {
    let view = size.view_box;
    let (left, bottom) = (bounds.left - view.left, bounds.bottom - view.bottom);
    let (right, top) = (bounds.right - view.left, bounds.top - view.bottom);
    let (width, height) = (view.right - view.left, view.top - view.bottom);
    match size.rotation {
        PageRotation::Degrees0 => ScreenEdges { left, bottom, top },
        PageRotation::Degrees90 => ScreenEdges {
            left: bottom,
            bottom: width - right,
            top: width - left,
        },
        PageRotation::Degrees180 => ScreenEdges {
            left: width - right,
            bottom: height - top,
            top: height - bottom,
        },
        PageRotation::Degrees270 => ScreenEdges {
            left: height - top,
            bottom: left,
            top: right,
        },
    }
}

fn edges(bounds: &TextBox) -> PageBox {
    PageBox {
        left: bounds.x,
        bottom: bounds.y,
        right: bounds.x + bounds.w,
        top: bounds.y + bounds.h,
    }
}

fn union(first: PageBox, second: PageBox) -> PageBox {
    PageBox {
        left: first.left.min(second.left),
        bottom: first.bottom.min(second.bottom),
        right: first.right.max(second.right),
        top: first.top.max(second.top),
    }
}

fn text_box(page: u32, bounds: &PageBox) -> TextBox {
    TextBox {
        page,
        x: bounds.left,
        y: bounds.bottom,
        w: bounds.right - bounds.left,
        h: bounds.top - bounds.bottom,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compare::model::{PageSizes, PageSources};

    const PAGE: u32 = 0;
    const PORTRAIT: PageSize = PageSize {
        view_box: PageBox {
            left: 0.0,
            bottom: 0.0,
            right: 595.0,
            top: 842.0,
        },
        rotation: PageRotation::Degrees0,
    };
    const LINE_HEIGHT: f32 = 10.0;

    /// 왼쪽 아래가 (`x`, `y`)이고 높이가 [`LINE_HEIGHT`]인 상자 하나를 A·B에 둔 `Replace`
    fn replace(id: &str, before: (f32, f32), after: (f32, f32)) -> Change {
        let side = |(x, y): (f32, f32)| Placement::Boxes {
            text: id.to_owned(),
            boxes: vec![TextBox {
                page: PAGE,
                x,
                y,
                w: LINE_HEIGHT,
                h: LINE_HEIGHT,
            }],
            min_confidence: None,
        };
        Change {
            id: id.to_owned(),
            kind: ChangeKind::Replace,
            before: side(before),
            after: side(after),
            page_pair: (Some(PAGE), Some(PAGE)),
            needs_review: false,
        }
    }

    fn result(changes: Vec<Change>) -> CompareResult {
        CompareResult {
            changes,
            page_pairs: vec![(Some(PAGE), Some(PAGE))],
            page_sizes: PageSizes {
                before: vec![PORTRAIT],
                after: vec![PORTRAIT],
            },
            page_sources: PageSources {
                before: vec![None],
                after: vec![None],
            },
            notices: Vec::new(),
        }
    }

    fn grouped_ids(changes: Vec<Change>) -> Vec<Vec<String>> {
        connector_stems(&result(changes), &[])
            .into_iter()
            .flat_map(|row| row.stems)
            .map(|stem| stem.change_ids)
            .collect()
    }

    /// 간격이 정확히 20pt면 붙고(이하), 그보다 조금이라도 크면 가른다. 픽스처 golden(약 17·23pt)이
    /// 닿지 않는 경계 자체를 고정한다.
    #[test]
    fn gap_of_exactly_twenty_points_joins_and_more_splits() {
        let top = 700.0;
        let joined_below = top - CONNECTOR_GAP_PT - LINE_HEIGHT;
        assert_eq!(
            grouped_ids(vec![
                replace("upper", (60.0, top), (60.0, top)),
                replace("lower", (60.0, joined_below), (60.0, joined_below)),
            ]),
            vec![vec!["upper".to_owned(), "lower".to_owned()]]
        );

        let split_below = joined_below - 0.5;
        assert_eq!(
            grouped_ids(vec![
                replace("upper", (60.0, top), (60.0, top)),
                replace("lower", (60.0, split_below), (60.0, split_below)),
            ]),
            vec![vec!["upper".to_owned()], vec!["lower".to_owned()]]
        );
    }
}
