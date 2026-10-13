//! 정규화·토큰화의 golden 검증(ADR 0001 §9). 픽스처는 `tokenize-korean.pdf`
//! (`generate_compare_fixtures.py`)이고, 픽스처나 규칙을 바꾸면 `UPDATE_GOLDEN=1`로 다시 쓴 뒤
//! 바뀐 토큰을 눈으로 확인한다.

mod common;

use common::{assert_matches_golden, engine, fixture_path};
use pdf_core::{
    ExtractedPage, NormalizeOptions, UnicodeForm, extract_text_layer, has_low_text_confidence,
    tokenize,
};

const FIXTURE: &str = "tokenize-korean.pdf";
/// golden 깊이: 토큰 배열 → 토큰 → `keyBoxes`. 상자 하나가 한 줄이다.
const TOKENIZE_GOLDEN_DEPTH: usize = 3;
/// 픽스처에서 ToUnicode가 PUA를 가리키는 쪽
const BROKEN_TO_UNICODE_PAGE: u32 = 2;

fn fixture_pages() -> Vec<ExtractedPage> {
    extract_text_layer(engine(), &fixture_path(FIXTURE)).expect("extract text layer")
}

/// 기본 옵션(NFC, 대소문자 구분): 공백·줄바꿈 없이 단어로 나뉘고, 줄 끝 하이픈은 pdfium이 이은
/// 것(`co-operation`)·숫자 뒤(`123-45-67890`)·쪽 경계(`갑-을`)에서 하이픈째 이어지며 홀로 선
/// `-`는 잇지 않는다. 키 글자마다 원본 글자 상자가 하나씩 있다.
#[test]
fn korean_tokens_match_golden() {
    let tokens = tokenize(&fixture_pages(), NormalizeOptions::default());
    assert_matches_golden(
        &tokens,
        "tokenize-korean.tokens.json",
        TOKENIZE_GOLDEN_DEPTH,
    );
}

/// NFKC + 대소문자 무시는 비교 키만 바꾼다(`㈜` → `(주)` 세 글자가 `㈜` 상자를 함께 쓰고,
/// `™` → `tm`, `²` → `2`). 원문은 기본 옵션과 같다.
#[test]
fn nfkc_ignore_case_tokens_match_golden() {
    let options = NormalizeOptions {
        form: UnicodeForm::Nfkc,
        ignore_case: true,
    };
    let tokens = tokenize(&fixture_pages(), options);
    assert_matches_golden(
        &tokens,
        "tokenize-korean.nfkc-ignore-case.tokens.json",
        TOKENIZE_GOLDEN_DEPTH,
    );
}

/// ToUnicode가 PUA를 가리키는 쪽만 LowTextConfidence 대상이다.
#[test]
fn broken_to_unicode_page_has_low_text_confidence() {
    let low_pages: Vec<u32> = (0_u32..)
        .zip(fixture_pages())
        .filter(|(_, page)| has_low_text_confidence(page))
        .map(|(page_number, _)| page_number)
        .collect();
    assert_eq!(low_pages, vec![BROKEN_TO_UNICODE_PAGE]);
}
