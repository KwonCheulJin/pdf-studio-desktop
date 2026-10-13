//! 글자 갈래(한자·라틴 글자). 예상 토큰(ADR 0002 §4 "글 토큰")과 언어 감지(계획서 Q4)가 같은
//! 판정을 쓴다. 의존성 없이 유니코드 블록 범위로 본다.

use std::ops::RangeInclusive;

/// CJK 통합 한자(확장 A, 기본, 호환 한자, 2·3 평면의 확장 B 이후·호환 보충)
const HAN_RANGES: [RangeInclusive<char>; 4] = [
    '\u{3400}'..='\u{4DBF}',
    '\u{4E00}'..='\u{9FFF}',
    '\u{F900}'..='\u{FAFF}',
    '\u{20000}'..='\u{323AF}',
];

/// 라틴 글자: 기본 라틴 알파벳, 라틴-1 보충·확장 A·B·추가 확장의 글자. 라틴-1 보충의 `×`·`÷`는
/// 글자가 아니므로 `is_alphabetic`으로 거른다.
const LATIN_RANGES: [RangeInclusive<char>; 5] = [
    'A'..='Z',
    'a'..='z',
    '\u{00C0}'..='\u{00FF}',
    '\u{0100}'..='\u{024F}',
    '\u{1E00}'..='\u{1EFF}',
];

pub(crate) fn is_han(c: char) -> bool {
    HAN_RANGES.iter().any(|range| range.contains(&c))
}

pub(crate) fn is_latin_letter(c: char) -> bool {
    c.is_alphabetic() && LATIN_RANGES.iter().any(|range| range.contains(&c))
}
