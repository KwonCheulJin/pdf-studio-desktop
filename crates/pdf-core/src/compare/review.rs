//! OCR 신뢰도와 "확인 필요"(`needs_review`) 판정. 규칙의 정본은 ADR 0001 §5다.
//!
//! - OCR 토큰은 OCR 글자가 하나라도 든 토큰(`Token::confidence`가 있다)이다.
//! - 확인 필요: 걸린 OCR 토큰 중 기준 미만이 있거나, OCR 토큰이 걸린 `Replace`가 띄어쓰기만 또는
//!   문장부호(유니코드 P*)와 띄어쓰기만 다르다. OCR은 띄어쓰기를 자주 틀리고 끝 마침표·쉼표를 높은
//!   신뢰도로 빠뜨리는데, 빠진 글자에는 신뢰도가 없어 기준으로는 잡히지 않는다.

use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use super::model::ChangeKind;
use super::tokenize::Token;

/// 일반 OCR 토큰 신뢰도 기준. 이보다 낮으면(같으면 통과) 그 토큰이 걸린 변경은 확인 필요다.
/// P2-2a 측정으로 시작값 그대로 확정했다(계획서 §6.4).
pub const OCR_MIN_CONFIDENCE: f32 = 0.80;
/// 숫자 토큰(정규화 키에 ASCII 숫자가 하나라도 든 토큰) 신뢰도 기준. 금액·날짜·조항 번호는 더
/// 엄격하게 본다. P2-2a에서 틀린 숫자 토큰이 모두 이 값 미만이었다(계획서 §6.4).
pub const OCR_MIN_CONFIDENCE_NUMERIC: f32 = 0.95;

/// 신뢰도 범위
const MIN_CONFIDENCE_VALUE: f32 = 0.0;
const MAX_CONFIDENCE_VALUE: f32 = 1.0;

/// OCR 글자가 든 토큰이 있다.
pub(super) fn has_ocr_token(tokens: &[Token]) -> bool {
    tokens.iter().any(|token| token.confidence.is_some())
}

/// 토큰 중 OCR 토큰 신뢰도의 최솟값(`[0, 1]`로 자르고 NaN은 뺀다). OCR 토큰이 없으면 `None`
pub(super) fn min_confidence(tokens: &[Token]) -> Option<f32> {
    tokens
        .iter()
        .filter_map(|token| token.confidence)
        .filter(|confidence| !confidence.is_nan())
        .reduce(f32::min)
        .map(|confidence| confidence.clamp(MIN_CONFIDENCE_VALUE, MAX_CONFIDENCE_VALUE))
}

/// 변경이 확인 필요인가(ADR 0001 §5의 세 규칙). 문맥 토큰은 보지 않는다. 띄어쓰기만 다른
/// 치환(규칙 2)은 문장부호를 뺀 글자열도 같으므로 규칙 3 비교 하나로 함께 본다.
pub(super) fn needs_review(kind: ChangeKind, before: &[Token], after: &[Token]) -> bool {
    let below_threshold = before.iter().chain(after).any(is_below_threshold);
    let ocr_replace =
        kind == ChangeKind::Replace && (has_ocr_token(before) || has_ocr_token(after));
    below_threshold
        || (ocr_replace
            && letters_without_punctuation(before).eq(letters_without_punctuation(after)))
}

fn is_below_threshold(token: &Token) -> bool {
    let threshold = if token.key.chars().any(|ch| ch.is_ascii_digit()) {
        OCR_MIN_CONFIDENCE_NUMERIC
    } else {
        OCR_MIN_CONFIDENCE
    };
    token
        .confidence
        .is_some_and(|confidence| confidence < threshold)
}

/// 토큰 키를 공백 없이 잇고 문장부호(유니코드 일반 범주 P*)를 뺀 글자열
fn letters_without_punctuation(tokens: &[Token]) -> impl Iterator<Item = char> + '_ {
    tokens
        .iter()
        .flat_map(|token| token.key.chars())
        .filter(|ch| ch.general_category_group() != GeneralCategoryGroup::Punctuation)
}
