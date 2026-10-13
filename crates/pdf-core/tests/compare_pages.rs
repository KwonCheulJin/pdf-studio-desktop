//! 페이지 짝짓기의 golden 검증(ADR 0001 §3·§12). 픽스처는 빈 쪽(2쪽)이 낀 5쪽 원본
//! `pages-base.pdf`와 변형 `pages-*.pdf`(`generate_compare_fixtures.py`)다. 픽스처나 규칙을
//! 바꾸면 `UPDATE_GOLDEN=1`로 다시 쓴 뒤 바뀐 행을 눈으로 확인한다.

mod common;

use std::time::Duration;

use common::{assert_matches_golden, engine, fixture_path};
use pdf_core::{
    ComparedPages, DIFF_TIME_LIMIT, NormalizeOptions, PagePair, PageSize, PageSizes, Token,
    diff_tokens, extract_text_layer, pair_pages, tokenize,
};

const BASE: &str = "pages-base.pdf";
/// golden 깊이: 행 배열 → 행. 행 하나가 한 줄이다.
const PAGE_PAIRS_GOLDEN_DEPTH: usize = 1;

/// 문서의 모든 쪽 번호(비교 범위 = 전체)와 토큰열, 쪽 크기
fn fixture_pages(name: &str) -> (Vec<u32>, Vec<Token>, Vec<PageSize>) {
    let pages = extract_text_layer(engine(), &fixture_path(name)).expect("extract text layer");
    let page_count = u32::try_from(pages.len()).expect("page count fits u32");
    (
        (0..page_count).collect(),
        tokenize(&pages, NormalizeOptions::default()),
        pages.iter().map(|page| page.size).collect(),
    )
}

/// 원본과 변형을 diff한 공통 토큰 짝으로 쪽을 짝짓는다. 짝짓기가 기대는 `matches` 계약(같은 키끼리,
/// 두 색인이 함께 늘어난다)과 ADR 0001 §3의 `page_pairs` 불변식도 함께 확인한다.
fn pair_with_base(variant: &str, time_limit: Duration) -> (Vec<PagePair>, bool) {
    let (before_pages, before, before_sizes) = fixture_pages(BASE);
    let (after_pages, after, after_sizes) = fixture_pages(variant);
    let sizes = PageSizes {
        before: before_sizes,
        after: after_sizes,
    };
    let pages = ComparedPages {
        before: &before_pages,
        after: &after_pages,
        sizes: &sizes,
    };
    let diff = diff_tokens(&before, &after, &pages, time_limit);
    for &(before_index, after_index) in &diff.matches {
        assert_eq!(before[before_index].key, after[after_index].key);
    }
    assert!(
        diff.matches
            .windows(2)
            .all(|pair| pair[0].0 < pair[1].0 && pair[0].1 < pair[1].1),
        "matches must increase on both sides"
    );

    let pairs = pair_pages(&before_pages, &after_pages, &before, &after, &diff.matches);
    assert_page_pairs_invariants(&pairs, &before_pages, &after_pages);
    (pairs, diff.truncated.is_some())
}

/// 범위의 각 쪽이 자기 쪽 성분에 오름차순으로 정확히 한 번 나오고, `(None, None)`이 없고, 같은 두
/// 짝 사이에서 A만 있는 행이 B만 있는 행보다 먼저다.
fn assert_page_pairs_invariants(pairs: &[PagePair], before_pages: &[u32], after_pages: &[u32]) {
    let before_rows: Vec<u32> = pairs.iter().filter_map(|pair| pair.0).collect();
    let after_rows: Vec<u32> = pairs.iter().filter_map(|pair| pair.1).collect();
    assert_eq!(before_rows, before_pages, "{pairs:?}");
    assert_eq!(after_rows, after_pages, "{pairs:?}");
    assert!(!pairs.contains(&(None, None)), "{pairs:?}");
    assert!(
        !pairs
            .windows(2)
            .any(|rows| matches!(rows, [(None, Some(_)), (Some(_), None)])),
        "{pairs:?}"
    );
}

fn assert_pairs_match_golden(variant: &str, golden_name: &str) {
    let (pairs, truncated) = pair_with_base(variant, DIFF_TIME_LIMIT);
    assert!(!truncated, "small fixtures never hit the time limit");
    assert_matches_golden(&pairs, golden_name, PAGE_PAIRS_GOLDEN_DEPTH);
}

/// B가 1쪽 뒤에 새 쪽을 넣으면 그 쪽만 B만 있는 행이다. 새 쪽과 흔한 낱말이 겹치는 앞뒤 쪽은
/// 제자리 짝을 지키고, 새 쪽 뒤 빈 쪽은 A의 빈 쪽과 짝이다.
#[test]
fn inserted_page_matches_golden() {
    assert_pairs_match_golden("pages-insert.pdf", "pages-insert.page-pairs.json");
}

/// A 1쪽을 지우면 그 쪽만 A만 있는 행이고, 지운 쪽 뒤 빈 쪽은 B의 빈 쪽과 짝이다.
#[test]
fn deleted_page_matches_golden() {
    assert_pairs_match_golden("pages-delete.pdf", "pages-delete.page-pairs.json");
}

/// 쪽 순서를 둔 채 낱말·숫자를 고치면 같은 위치 쪽끼리 짝이다(빈 쪽 포함).
#[test]
fn edited_pages_keep_their_order() {
    assert_pairs_match_golden("pages-edit.pdf", "pages-edit.page-pairs.json");
}

/// 앞에 넣은 문단 때문에 쪽 내용이 반 넘게 다음 쪽으로 밀리면 A 쪽은 내용이 더 많이 옮겨 간 B 쪽과
/// 짝이고, 전문과 두 줄만 남은 B 0쪽은 B만 있는 행이다.
#[test]
fn pushed_content_pairs_with_the_page_it_mostly_moved_to() {
    assert_pairs_match_golden("pages-push.pdf", "pages-push.page-pairs.json");
}

/// 시간 제한이 이미 지나 구간을 통째로 내도(3쪽 `3년간` → `5년간`) 앵커(양쪽 유일 토큰)와 구간
/// 앞뒤에서 뗀 공통 토큰은 공통 토큰이므로 쪽 짝은 정밀 diff 때와 같다.
#[test]
fn expired_time_limit_still_pairs_pages_by_anchors() {
    let (pairs, truncated) = pair_with_base("pages-insert.pdf", Duration::ZERO);

    assert!(truncated, "the edited gap must be replaced whole");
    assert_matches_golden(
        &pairs,
        "pages-insert.page-pairs.json",
        PAGE_PAIRS_GOLDEN_DEPTH,
    );
}
