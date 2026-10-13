//! 연결선 끝·모양의 golden 검증(계획서 §7.1). 픽스처는 `connector-geometry-a.pdf`·
//! `connector-geometry-b.pdf`(`generate_compare_fixtures.py`, 회전 0·90·180·270과 CropBox 오프셋·
//! MediaBox 원점 쪽)이고, 실행기(`compare_pdfs`)로 비교한 결과에서 변경마다 연결선을 만든다. 화면
//! E2E(`e2e/compare-connectors.spec.ts`)가 같은 golden으로 결과를 시드하고 화면 줄 표시(끝의 `row`,
//! 화면 방향 pt)·끝점·모양을 맞대므로, 픽스처나 규칙을 바꾸면 `UPDATE_GOLDEN=1`로 다시 쓴 뒤 바뀐 끝을
//! 눈으로 확인하고 E2E까지 통과시킨다.

mod common;

use std::sync::atomic::AtomicBool;

use common::{assert_matches_golden, engine, fixture_path};
use pdf_core::{
    ChangeKind, CompareOptions, CompareRequest, CompareResult, Connector, ConnectorShape,
    ExtractionCache, PagePair, PageSize, compare_pdfs, connectors,
};
use serde::Serialize;

const BEFORE: &str = "connector-geometry-a.pdf";
const AFTER: &str = "connector-geometry-b.pdf";
/// golden 깊이는 `compare_diff.rs`와 같다: 변경 → 쪽 → 상자
const CHANGES_GOLDEN_DEPTH: usize = 4;
/// golden 깊이: 최상위 → 연결선 배열 → 연결선. 끝은 한 줄이다.
const CONNECTORS_GOLDEN_DEPTH: usize = 3;

/// 화면 E2E가 결과를 다시 세우는 데 필요한 행·쪽 크기와 변경마다의 연결선
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorsGolden<'r> {
    page_pairs: &'r [PagePair],
    page_sizes: SizesGolden<'r>,
    connectors: &'r [Connector],
}

#[derive(Serialize)]
struct SizesGolden<'r> {
    before: &'r [PageSize],
    after: &'r [PageSize],
}

fn compare_fixtures() -> CompareResult {
    let request = CompareRequest {
        job_id: "connector-geometry".to_owned(),
        before: fixture_path(BEFORE),
        after: fixture_path(AFTER),
        options: CompareOptions::default(),
    };
    compare_pdfs(
        engine(),
        &request,
        None,
        None,
        &ExtractionCache::new(),
        &AtomicBool::new(false),
        |_| {},
    )
    .expect("compare fixtures")
}

/// 연결선 하나를 (종류, 글자, 모양, A 끝 쪽·앵커, B 끝 쪽·앵커)로 적는다. 글자는 글자가 있는 쪽
/// (A 먼저)의 글자다.
type Summary = (ChangeKind, String, ConnectorShape, (u32, bool), (u32, bool));

fn summaries(result: &CompareResult, drawn: &[Connector]) -> Vec<Summary> {
    drawn
        .iter()
        .map(|connector| {
            let change = result
                .changes
                .iter()
                .find(|change| change.id == connector.change_id)
                .expect("connector of a change");
            let text = change
                .before
                .text()
                .or(change.after.text())
                .unwrap_or_default()
                .to_owned();
            (
                connector.kind,
                text,
                connector.shape,
                (connector.before.bounds.page, connector.before.is_anchor),
                (connector.after.bounds.page, connector.after.is_anchor),
            )
        })
        .collect()
}

fn summary(
    kind: ChangeKind,
    text: &str,
    shape: ConnectorShape,
    before: (u32, bool),
    after: (u32, bool),
) -> Summary {
    (kind, text.to_owned(), shape, before, after)
}

/// 변경마다 연결선이 하나다. 한 줄·한 줄에 상자가 여럿인 치환·두 줄 치환은 선, 세 줄 치환과 세 줄
/// 삽입은 띠다. 삽입은 A 앵커, 삭제는 B 앵커에 잇고, 쪽을 넘는 치환은 첫 쪽(2쪽)에서 잇는다.
#[test]
fn connectors_match_golden() {
    use ChangeKind::{Delete, Insert, Replace};
    use ConnectorShape::{Band, Line};
    const BOXES: bool = false;
    const ANCHOR: bool = true;
    let result = compare_fixtures();
    let multi_box_line = result
        .changes
        .iter()
        .find(|change| change.before.text() == Some("2026년 1월 2일부터 3월 4일까지다."))
        .expect("multi-box replace");
    assert!(
        multi_box_line.before.boxes().len() > 2,
        "fixture lost the one-line replace with many boxes: {multi_box_line:?}"
    );
    let drawn = connectors(&result, &[]);

    assert_eq!(drawn.len(), result.changes.len());
    assert_eq!(
        summaries(&result, &drawn),
        [
            summary(Replace, "1,000,000원으로", Line, (0, BOXES), (0, BOXES)),
            summary(
                Replace,
                "2026년 1월 2일부터 3월 4일까지다.",
                Line,
                (0, BOXES),
                (0, BOXES)
            ),
            summary(Replace, "갑에게 넘긴다.", Line, (0, BOXES), (0, BOXES)),
            summary(
                Replace,
                "하자 보증 기간은 일 년이다. 보증금은 대금의 오 퍼센트다. 지체상금은 하루 천분의 일이다.",
                Band,
                (0, BOXES),
                (0, BOXES)
            ),
            summary(Insert, "상대방에게", Line, (0, ANCHOR), (0, BOXES)),
            summary(Delete, "두", Line, (0, BOXES), (0, ANCHOR)),
            summary(Replace, "열흘", Line, (1, BOXES), (1, BOXES)),
            summary(Insert, "바로", Line, (1, ANCHOR), (1, BOXES)),
            summary(
                Insert,
                "수정 내역은 별도 대장에 날짜와 담당자를 적어 발주자에게 함께 보인다.",
                Band,
                (1, ANCHOR),
                (1, BOXES)
            ),
            summary(Delete, "다시", Line, (1, BOXES), (1, ANCHOR)),
            summary(Delete, "남에게", Line, (2, BOXES), (2, ANCHOR)),
            summary(Replace, "삼", Line, (2, BOXES), (2, BOXES)),
            summary(Replace, "준다. 다만", Line, (2, BOXES), (2, BOXES)),
            summary(Replace, "갑의", Line, (3, BOXES), (3, BOXES)),
            summary(Insert, "양측이", Line, (3, ANCHOR), (3, BOXES)),
        ]
    );

    assert_matches_golden(
        &result.changes,
        "connector-geometry.changes.json",
        CHANGES_GOLDEN_DEPTH,
    );
    assert_matches_golden(
        &ConnectorsGolden {
            page_pairs: &result.page_pairs,
            page_sizes: SizesGolden {
                before: &result.page_sizes.before,
                after: &result.page_sizes.after,
            },
            connectors: &drawn,
        },
        "connector-geometry.connectors.json",
        CONNECTORS_GOLDEN_DEPTH,
    );
}

/// 숨긴 종류의 변경은 잇지 않고, 남은 종류는 그대로 잇는다.
#[test]
fn hidden_kinds_are_not_connected() {
    let result = compare_fixtures();

    let drawn = connectors(&result, &[ChangeKind::Replace, ChangeKind::Delete]);

    let kinds: Vec<ChangeKind> = drawn.iter().map(|connector| connector.kind).collect();
    assert_eq!(kinds, [ChangeKind::Insert; 4]);
}
