//! 변경이 놓이는 곳(`Placement`)의 검증(ADR 0001 §4·§10): 한쪽에만 있는 변경의 앵커와 같은 줄 상자
//! 병합. 픽스처는 `placement-a.pdf`·`placement-b.pdf`·`placement-blank.pdf`
//! (`generate_compare_fixtures.py`)이고 실행기(`compare_pdfs`)로 비교한다. 기대 상자는 추출한 글자의
//! tight 상자를 이 파일에서 직접 합쳐 세운다(토큰화·diff를 거치지 않는다). 픽스처나 규칙을 바꾸면
//! `UPDATE_GOLDEN=1`로 다시 쓴 뒤 바뀐 앵커·상자를 눈으로 확인한다.

mod common;

use std::sync::atomic::AtomicBool;

use common::{assert_matches_golden, engine, fixture_path};
use pdf_core::{
    Change, CompareOptions, CompareRequest, CompareResult, ExtractedPage, ExtractionCache,
    Placement, TextBox, compare_pdfs, extract_text_layer,
};

const BEFORE: &str = "placement-a.pdf";
const AFTER: &str = "placement-b.pdf";
const BLANK: &str = "placement-blank.pdf";
/// golden 깊이는 `compare_diff.rs`와 같다: 변경 → 쪽 → 상자
const CHANGES_GOLDEN_DEPTH: usize = 4;
/// 같은 pdfium 값을 다른 순서로 더하고 뺀 `f32` 차이만 흡수한다.
const TOLERANCE_PT: f32 = 0.01;
/// 픽스처 쪽(A4 세로, 원점 0)의 높이와 빈 쪽 앵커를 쪽 가장자리에서 들이는 거리(ADR 0001 §4)
const A4_HEIGHT_PT: f32 = 842.0;
const EMPTY_PAGE_INSET_PT: f32 = 72.0;

fn compare(before: &str, after: &str, options: CompareOptions) -> CompareResult {
    let request = CompareRequest {
        job_id: "placement".to_owned(),
        before: fixture_path(before),
        after: fixture_path(after),
        options,
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

fn extract(name: &str) -> Vec<ExtractedPage> {
    extract_text_layer(engine(), &fixture_path(name)).expect("extract text layer")
}

/// `page` 쪽에서 공백 없이 이은 글자열의 `word`(공백 없이 쓴 낱말들) 글자 tight 상자의 합집합
fn glyph_union(pages: &[ExtractedPage], page: u32, word: &str) -> TextBox {
    let glyphs: Vec<(char, TextBox)> = pages[page as usize]
        .chars
        .iter()
        .filter(|extracted| !extracted.ch.is_whitespace())
        .filter_map(|extracted| Some((extracted.ch, extracted.glyph?.bounds)))
        .collect();
    let target: Vec<char> = word.chars().collect();
    let start = glyphs
        .windows(target.len())
        .position(|window| window.iter().map(|(ch, _)| *ch).eq(target.iter().copied()))
        .unwrap_or_else(|| panic!("{word:?} not on page {page}"));
    let edges = glyphs[start..start + target.len()].iter().fold(
        (f32::MAX, f32::MAX, f32::MIN, f32::MIN),
        |(left, bottom, right, top), (_, bounds)| {
            (
                left.min(bounds.x),
                bottom.min(bounds.y),
                right.max(bounds.x + bounds.w),
                top.max(bounds.y + bounds.h),
            )
        },
    );
    let (left, bottom, right, top) = edges;
    TextBox {
        page,
        x: left,
        y: bottom,
        w: right - left,
        h: top - bottom,
    }
}

/// 한쪽 글자가 `text`인 변경
fn change_with<'r>(result: &'r CompareResult, text: &str) -> &'r Change {
    result
        .changes
        .iter()
        .find(|change| change.before.text() == Some(text) || change.after.text() == Some(text))
        .unwrap_or_else(|| panic!("no change with {text:?}: {:#?}", result.changes))
}

fn assert_near(actual: f32, expected: f32, what: &str) {
    assert!(
        (actual - expected).abs() <= TOLERANCE_PT,
        "{what}: expected {expected}, got {actual}"
    );
}

fn assert_anchor(placement: &Placement, page: u32, x: f32, y: f32, h: f32, what: &str) {
    let Placement::Anchor {
        page: actual_page,
        x: actual_x,
        y: actual_y,
        h: actual_h,
    } = *placement
    else {
        panic!("{what}: expected an anchor, got {placement:?}");
    };
    assert_eq!(actual_page, page, "{what}: page");
    assert_near(actual_x, x, &format!("{what}: x"));
    assert_near(actual_y, y, &format!("{what}: y"));
    assert_near(actual_h, h, &format!("{what}: h"));
}

fn assert_boxes(actual: &[TextBox], expected: &[TextBox], what: &str) {
    assert_eq!(actual.len(), expected.len(), "{what}: {actual:?}");
    for (actual, expected) in actual.iter().zip(expected) {
        assert_eq!(actual.page, expected.page, "{what}: page");
        for (actual_value, expected_value) in [
            (actual.x, expected.x),
            (actual.y, expected.y),
            (actual.w, expected.w),
            (actual.h, expected.h),
        ] {
            assert_near(actual_value, expected_value, what);
        }
    }
}

/// 이웃 공통 토큰 기준 앵커: 앞 토큰이 있으면 그 줄 상자의 오른쪽 끝(줄 경계·쪽 경계에서도 앞 줄·앞
/// 쪽 끝), 문서 맨 앞이면 뒤 토큰 줄 상자의 왼쪽 끝이다. 같은 줄 이웃 글자 상자는 하나로 합치고, 줄을
/// 넘거나 단 사이 간격을 건너면 따로 둔다.
#[test]
fn anchors_and_line_boxes_follow_neighbor_tokens() {
    let result = compare(BEFORE, AFTER, CompareOptions::default());
    let (before, after) = (extract(BEFORE), extract(AFTER));

    // (변경 글자, 그 변경의 앵커 쪽 문서 글자, 이웃 토큰 쪽·낱말, 이웃 줄 상자의 오른쪽 끝을 쓰나)
    let anchor_cases = [
        ("전문", &before, (0, "제1조(목적)"), false),
        ("서로의 모든", &before, (0, "을의"), true),
        ("총", &before, (0, "정한다."), true),
        ("금", &after, (0, "금액은"), true),
        ("부칙", &before, (0, "지급한다."), true),
        ("끝.", &before, (1, "만든다."), true),
    ];
    for (text, pages, (page, neighbor), is_right_end) in anchor_cases {
        let change = change_with(&result, text);
        let line = glyph_union(pages, page, neighbor);
        let x = if is_right_end {
            line.x + line.w
        } else {
            line.x
        };
        let anchor = match change.before.text() {
            Some(_) => &change.after,
            None => &change.before,
        };
        assert_anchor(anchor, page, x, line.y, line.h, text);
    }

    assert_boxes(
        change_with(&result, "서로의 모든").after.boxes(),
        &[glyph_union(&after, 0, "서로의모든")],
        "two words on one line",
    );
    assert_boxes(
        change_with(&result, "상대방은 서면으로 통지하고 그 뒤에")
            .after
            .boxes(),
        &[
            glyph_union(&after, 1, "상대방은서면으로통지하고"),
            glyph_union(&after, 1, "그뒤에"),
        ],
        "insert across a line break",
    );
    assert_boxes(
        change_with(&result, "모두 또한").after.boxes(),
        &[
            glyph_union(&after, 2, "모두"),
            glyph_union(&after, 2, "또한"),
        ],
        "insert across two columns at the same height",
    );

    assert_matches_golden(
        &result.changes,
        "placement.changes.json",
        CHANGES_GOLDEN_DEPTH,
    );
}

/// 반대쪽에 토큰이 없으면 쪽 짝으로 쪽을 고른다: 짝 쪽의 위 여백, 짝이 없으면 앞 행 중 가장 가까운
/// 반대쪽 쪽의 아래 여백, 앞에도 없으면 뒤 행 중 가장 가까운 반대쪽 쪽의 위 여백. 막대 높이는 변경 첫
/// 상자 높이이고, 여백은 A4 쪽 왼쪽·위(아래)에서 72pt다.
#[test]
fn empty_opposite_side_anchors_on_page_margins() {
    let first_box_height = |placement: &Placement| placement.boxes()[0].h;

    let paired = compare(
        BLANK,
        AFTER,
        CompareOptions {
            range_b: "1".to_owned(),
            ..CompareOptions::default()
        },
    );
    assert_eq!(paired.page_pairs, [(Some(0), Some(0))]);
    let [inserted] = paired.changes.as_slice() else {
        panic!("one insert: {:#?}", paired.changes);
    };
    let height = first_box_height(&inserted.after);
    assert_anchor(
        &inserted.before,
        0,
        EMPTY_PAGE_INSET_PT,
        A4_HEIGHT_PT - EMPTY_PAGE_INSET_PT - height,
        height,
        "paired blank page: top margin",
    );

    let unpaired = compare(BLANK, AFTER, CompareOptions::default());
    assert_eq!(
        unpaired.page_pairs,
        [
            (Some(0), None),
            (None, Some(0)),
            (None, Some(1)),
            (None, Some(2))
        ]
    );
    let [inserted] = unpaired.changes.as_slice() else {
        panic!("one insert: {:#?}", unpaired.changes);
    };
    let height = first_box_height(&inserted.after);
    assert_anchor(
        &inserted.before,
        0,
        EMPTY_PAGE_INSET_PT,
        EMPTY_PAGE_INSET_PT,
        height,
        "no paired page: bottom margin of the nearest earlier page",
    );

    let deleted = compare(BEFORE, BLANK, CompareOptions::default());
    assert_eq!(
        deleted.page_pairs,
        [
            (Some(0), None),
            (Some(1), None),
            (Some(2), None),
            (None, Some(0))
        ]
    );
    let [removed] = deleted.changes.as_slice() else {
        panic!("one delete: {:#?}", deleted.changes);
    };
    let height = first_box_height(&removed.before);
    assert_anchor(
        &removed.after,
        0,
        EMPTY_PAGE_INSET_PT,
        A4_HEIGHT_PT - EMPTY_PAGE_INSET_PT - height,
        height,
        "no earlier page: top margin of the nearest later page",
    );
}
