//! 정렬과 diff의 golden 검증(ADR 0001 §4·§10). 픽스처는 `diff-*.pdf`
//! (`generate_compare_fixtures.py`)이고, 픽스처나 규칙을 바꾸면 `UPDATE_GOLDEN=1`로 다시 쓴 뒤
//! 바뀐 변경(종류·글자·상자·id)을 눈으로 확인한다.

mod common;

use common::{assert_matches_golden, engine, fixture_path};
use pdf_core::{
    DIFF_TIME_LIMIT, NormalizeOptions, Token, TokenDiff, diff_tokens, extract_text_layer, tokenize,
};

const BASE: &str = "diff-base.pdf";
/// golden 깊이: 변경 배열 → 변경 → 쪽(`before`/`after`) → `boxes`. 상자 하나가 한 줄이다.
const CHANGES_GOLDEN_DEPTH: usize = 4;

fn fixture_tokens(name: &str) -> Vec<Token> {
    let pages = extract_text_layer(engine(), &fixture_path(name)).expect("extract text layer");
    tokenize(&pages, NormalizeOptions::default())
}

fn diff_with_base(variant: &str) -> TokenDiff {
    let diff = diff_tokens(
        &fixture_tokens(BASE),
        &fixture_tokens(variant),
        DIFF_TIME_LIMIT,
    );
    assert_eq!(
        diff.truncated, None,
        "small fixtures never hit the time limit"
    );
    diff
}

/// 단어 삽입·삭제·치환과 날짜·금액·비율 숫자 치환. 바꾼 곳마다 변경 하나이고, `Replace` 상자는
/// 실제로 다른 글자만 덮으며(`1,000,000` → `1,500,000`은 `0`과 `5`만), 한쪽에 다른 글자가 없으면
/// (`5%로` → `15%로`의 A 쪽) 토큰 전체를 덮는다. 같은 줄 글자는 상자 하나, 두 줄에 걸친 삽입은
/// 줄마다 하나다.
#[test]
fn edits_match_golden() {
    let diff = diff_with_base("diff-edit.pdf");
    assert_matches_golden(
        &diff.changes,
        "diff-edit.changes.json",
        CHANGES_GOLDEN_DEPTH,
    );
}

/// 1쪽 문단을 2쪽으로 옮기면 따로 이동 종류 없이 A 1쪽 `Delete` + B 2쪽 `Insert`다.
#[test]
fn moved_paragraph_is_delete_then_insert() {
    let diff = diff_with_base("diff-move.pdf");
    assert_matches_golden(
        &diff.changes,
        "diff-move.changes.json",
        CHANGES_GOLDEN_DEPTH,
    );
}

/// 같은 문구를 다른 위치에서 줄바꿈하면(한글 단어 중간에서 하이픈 없이 바꾼 줄, 옮긴 쪽 경계)
/// 토큰 경계가 달라도 차이가 없다.
#[test]
fn rewrapped_text_has_no_changes() {
    let diff = diff_with_base("diff-rewrap.pdf");
    assert!(diff.changes.is_empty(), "{:#?}", diff.changes);
}
