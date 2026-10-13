//! 연결선 묶기의 golden 검증(계획서 §7.1). 픽스처는 `connectors-a.pdf`·`connectors-b.pdf`
//! (`generate_compare_fixtures.py`)이고, 실행기(`compare_pdfs`)로 비교한 결과에서 행마다 묶음을 만든다.
//! 화면 E2E(`e2e/compare-connectors.spec.ts`)가 같은 두 golden으로 결과를 시드하고 연결선 끝점을
//! 맞대므로, 픽스처나 규칙을 바꾸면 `UPDATE_GOLDEN=1`로 다시 쓴 뒤 바뀐 묶음을 눈으로 확인하고 E2E까지
//! 통과시킨다.

mod common;

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

use common::{assert_matches_golden, engine, fixture_path};
use pdf_core::{
    ChangeKind, CompareOptions, CompareRequest, CompareResult, ExtractionCache, PagePair, PageSize,
    RowConnectors, compare_pdfs, connector_stems,
};
use serde::Serialize;

const BEFORE: &str = "connectors-a.pdf";
const AFTER: &str = "connectors-b.pdf";
/// golden 깊이는 `compare_diff.rs`와 같다: 변경 → 쪽 → 상자
const CHANGES_GOLDEN_DEPTH: usize = 4;
/// golden 깊이: 최상위 → 행 배열 → 행 → 묶음 배열 → 묶음. 묶음의 id 목록·상자는 한 줄이다.
const STEMS_GOLDEN_DEPTH: usize = 5;

/// 화면 E2E가 결과를 다시 세우는 데 필요한 행·쪽 크기와 행마다의 묶음
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorsGolden<'r> {
    page_pairs: &'r [PagePair],
    page_sizes: SizesGolden<'r>,
    rows: Vec<RowConnectors>,
}

#[derive(Serialize)]
struct SizesGolden<'r> {
    before: &'r [PageSize],
    after: &'r [PageSize],
}

fn compare_fixtures() -> CompareResult {
    let request = CompareRequest {
        job_id: "connectors".to_owned(),
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

/// 행 (A 쪽, B 쪽)의 묶음을 변경의 A 글자로 적는다.
fn grouped_texts(
    result: &CompareResult,
    rows: &[RowConnectors],
    pages: (u32, u32),
) -> Vec<Vec<String>> {
    let before_text: HashMap<&str, &str> = result
        .changes
        .iter()
        .filter_map(|change| Some((change.id.as_str(), change.before.as_ref()?.text.as_str())))
        .collect();
    rows.iter()
        .filter(|row| row.pages == pages)
        .flat_map(|row| &row.stems)
        .map(|stem| {
            stem.change_ids
                .iter()
                .map(|id| before_text[id.as_str()].to_owned())
                .collect()
        })
        .collect()
}

fn texts(group: &[&str]) -> Vec<String> {
    group.iter().map(|text| (*text).to_owned()).collect()
}

/// 세로 쪽 행: 여러 줄 변경은 혼자, 인접 변경 3개는 한 묶음, 20pt 경계 안의 두 변경은 묶고 밖은 가르며,
/// A만 경계 안이거나 B 순서가 뒤바뀐 두 변경은 가른다. 추가·삭제는 묶음에 없다.
/// 가로 쪽 행: A는 /Rotate 90에 돌려 그린 글자라 화면 방향 읽는 순서로 첫 두 줄 변경이 붙고(사용자 공간
/// 위쪽 모서리로 세면 순서가 뒤집혀 갈린다), 멀리 떨어진 셋째 줄은 따로다.
#[test]
fn stems_match_golden() {
    let result = compare_fixtures();
    assert_eq!(
        result.page_pairs,
        vec![(Some(0), Some(0)), (Some(1), Some(1))]
    );
    let kinds: Vec<ChangeKind> = result.changes.iter().map(|change| change.kind).collect();
    for kind in [ChangeKind::Insert, ChangeKind::Delete] {
        assert!(kinds.contains(&kind), "fixture lacks {kind:?}: {kinds:?}");
    }
    let rows = connector_stems(&result, &[]);

    assert_eq!(
        grouped_texts(&result, &rows, (0, 0)),
        [
            texts(&["서면으로 통지한"]),
            texts(&["1,000,000원으로", "30%로", "14일"]),
            texts(&["2일부터", "10일로"]),
            texts(&["1년으로"]),
            texts(&["5%로"]),
            texts(&["0.1%로"]),
            texts(&["10%를"]),
            texts(&["갑의"]),
            texts(&["2통을"]),
        ]
    );
    assert_eq!(
        grouped_texts(&result, &rows, (1, 1)),
        [texts(&["7일", "5일을"]), texts(&["2026년"])]
    );

    assert_matches_golden(
        &result.changes,
        "connectors.changes.json",
        CHANGES_GOLDEN_DEPTH,
    );
    assert_matches_golden(
        &ConnectorsGolden {
            page_pairs: &result.page_pairs,
            page_sizes: SizesGolden {
                before: &result.page_sizes.before,
                after: &result.page_sizes.after,
            },
            rows,
        },
        "connectors.stems.json",
        STEMS_GOLDEN_DEPTH,
    );
}

/// 숨긴 종류의 변경은 입력에서 뺀다: 변경(`Replace`)을 숨기면 이을 변경이 없어 묶음도 없다.
#[test]
fn hidden_kinds_leave_no_stems() {
    let result = compare_fixtures();

    assert!(connector_stems(&result, &[ChangeKind::Replace]).is_empty());
}
