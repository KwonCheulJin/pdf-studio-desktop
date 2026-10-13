//! 문단 글 규칙: 줄 잇기와 목록 머리(ADR 0002 §2 "줄 잇기"·"문단 나누기").

use std::ops::RangeInclusive;

use unicode_normalization::UnicodeNormalization;

use crate::compare::HYPHENS;

/// 줄을 이을 때 공백 없이 붙이는 CJK 글자(한자·가나·한글·전각 문장부호) 범위
const CJK_RANGES: [RangeInclusive<char>; 17] = [
    // 한글 자모
    '\u{1100}'..='\u{11FF}',
    // CJK 부수 보충·강희 부수
    '\u{2E80}'..='\u{2FDF}',
    // CJK 기호와 문장부호(`。`·`、`·`「」`·전각 공백), 히라가나, 가타카나
    '\u{3000}'..='\u{30FF}',
    // 한글 호환 자모
    '\u{3130}'..='\u{318F}',
    // 가타카나 음성 확장
    '\u{31F0}'..='\u{31FF}',
    // 괄호·원 문자 CJK(`㈜`·`㊀`)
    '\u{3200}'..='\u{32FF}',
    // CJK 통합 한자 확장 A
    '\u{3400}'..='\u{4DBF}',
    // CJK 통합 한자
    '\u{4E00}'..='\u{9FFF}',
    // 한글 자모 확장 A
    '\u{A960}'..='\u{A97F}',
    // 한글 음절, 한글 자모 확장 B
    '\u{AC00}'..='\u{D7FF}',
    // CJK 호환 한자
    '\u{F900}'..='\u{FAFF}',
    // 세로쓰기 문장부호
    '\u{FE10}'..='\u{FE1F}',
    // CJK 호환 꼴(세로 괄호 등)
    '\u{FE30}'..='\u{FE4F}',
    // 반각·전각 꼴(`，`·`：`·`（）`, 전각 라틴·반각 가타카나)
    '\u{FF00}'..='\u{FFEF}',
    // CJK 통합 한자 확장 B~F
    '\u{20000}'..='\u{2EBEF}',
    // CJK 호환 한자 보충
    '\u{2F800}'..='\u{2FA1F}',
    // CJK 통합 한자 확장 G·H
    '\u{30000}'..='\u{323AF}',
];

/// 줄 첫 글자로 오면 목록 머리인 글머리표
const BULLETS: [char; 13] = [
    '•', '‣', '⁃', '●', '○', '■', '□', '◆', '◇', '▪', '▶', '►', '※',
];
/// 뒤에 공백이 오면 글머리표로 보는 글자(`- 항목`, `* 항목`)
const BULLET_MARKS: [char; 3] = ['-', '\u{2013}', '*'];
/// 원·괄호·마침표 숫자(`①`~`⑳`, `⑴`~`⒇`, `⒈`~`⒛`, `㉑`~`㉟`, `㊱`~`㊿`)
const ENCLOSED_NUMBERS: [RangeInclusive<char>; 3] = [
    '\u{2460}'..='\u{249B}',
    '\u{3251}'..='\u{325F}',
    '\u{32B1}'..='\u{32BF}',
];
const OPEN_PARENTHESES: [char; 2] = ['(', '（'];
const CLOSE_PARENTHESES: [char; 2] = [')', '）'];
/// 번호 뒤에 오면 목록 머리인 글자(`1.`, `1)`, `1、`). 마침표 뒤에 숫자가 오면 소수다(`1.5`).
const NUMBER_TERMINATORS: [char; 5] = ['.', '．', ')', '）', '、'];
const DECIMAL_POINTS: [char; 2] = ['.', '．'];
/// 한자 수사(`一、`, `（二）`, `第十条`)
const HAN_NUMERALS: [char; 13] = [
    '零', '〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '百',
];
/// `第…条`의 단위(간체·번체)
const ARTICLE_UNITS: [char; 10] = ['条', '條', '章', '节', '節', '款', '项', '項', '编', '編'];
const ARTICLE_PREFIX: char = '第';
/// 로마 숫자 글자(`(iv)`)
const ROMAN_DIGITS: [char; 7] = ['i', 'v', 'x', 'l', 'c', 'd', 'm'];
/// 번호 글자 수 상한. `2026.`처럼 줄 앞에 온 연도는 목록 머리가 아니다.
const MAX_NUMBER_DIGITS: usize = 3;
const MAX_HAN_NUMERALS: usize = 3;
const MAX_ROMAN_DIGITS: usize = 4;
/// `第…条` 사이 번호 글자 수 상한
const MAX_ARTICLE_NUMBER_CHARS: usize = 6;

pub(super) fn is_cjk(ch: char) -> bool {
    CJK_RANGES.iter().any(|range| range.contains(&ch))
}

/// 줄 글을 잇는다. 공백(전각 공백 포함)이 이어지면 하나로 두고 앞뒤 공백을 지운다. 앞 줄 끝 글자와 다음
/// 줄 첫 글자가 둘 다 CJK면 그냥 잇고, 줄 끝 하이픈 단어는 ADR 0001 §9처럼 하이픈째 잇고, 그 밖은 공백
/// 하나로 잇는다. 결과는 NFC다.
pub(super) fn join_lines<'a>(lines: impl IntoIterator<Item = &'a str>) -> String {
    let mut text = String::new();
    for line in lines {
        let line = collapse_spaces(line);
        let (Some(last), Some(first)) = (text.chars().last(), line.chars().next()) else {
            text.push_str(&line);
            continue;
        };
        if !(continues_after_hyphen(&text, first) || (is_cjk(last) && is_cjk(first))) {
            text.push(' ');
        }
        text.push_str(&line);
    }
    text.nfc().collect()
}

fn collapse_spaces(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 앞 글이 글자·숫자 + 하이픈으로 끝나고 다음 줄이 글자·숫자로 시작한다(`co-` + `operation`).
fn continues_after_hyphen(text: &str, next: char) -> bool {
    let mut tail = text.chars().rev();
    let (Some(hyphen), Some(before)) = (tail.next(), tail.next()) else {
        return false;
    };
    HYPHENS.contains(&hyphen) && before.is_alphanumeric() && next.is_alphanumeric()
}

/// 줄이 목록 머리로 시작한다: 글머리표, 원 숫자, `(1)`·`（一）`·`(a)`·`(iv)`, `1.`·`1)`·`1、`·`一、`·`a)`,
/// `第…条`(장·절·관·항·편 포함).
pub(super) fn starts_with_list_head(line: &str) -> bool {
    let chars: Vec<char> = line.trim_start().chars().collect();
    let Some(&first) = chars.first() else {
        return false;
    };
    BULLETS.contains(&first)
        || (BULLET_MARKS.contains(&first) && chars.get(1).is_some_and(|ch| ch.is_whitespace()))
        || ENCLOSED_NUMBERS.iter().any(|range| range.contains(&first))
        || is_parenthesized_label(&chars)
        || is_terminated_label(&chars)
        || is_article_head(&chars)
}

/// `(1)`, `（一）`, `(a)`, `(iv)`
fn is_parenthesized_label(chars: &[char]) -> bool {
    let [open, rest @ ..] = chars else {
        return false;
    };
    if !OPEN_PARENTHESES.contains(open) {
        return false;
    }
    let label_len = rest
        .iter()
        .position(|ch| CLOSE_PARENTHESES.contains(ch))
        .unwrap_or(0);
    label_len > 0 && is_label(&rest[..label_len], true)
}

/// `1.`, `1)`, `1、`, `一、`, `a)`. 마침표 바로 뒤가 숫자면 소수(`1.5`)라 아니다.
fn is_terminated_label(chars: &[char]) -> bool {
    let Some(label_len) = chars.iter().position(|ch| NUMBER_TERMINATORS.contains(ch)) else {
        return false;
    };
    let terminator = chars[label_len];
    let label = &chars[..label_len];
    let is_decimal = DECIMAL_POINTS.contains(&terminator)
        && chars.get(label_len + 1).is_some_and(char::is_ascii_digit);
    // 영문자·로마 숫자는 괄호로 닫을 때만 본다(`A. Smith`처럼 줄 앞 머리글자와 헷갈린다).
    let is_letter_label = label.iter().all(char::is_ascii_alphabetic);
    label_len > 0
        && !is_decimal
        && is_label(
            label,
            CLOSE_PARENTHESES.contains(&terminator) || !is_letter_label,
        )
}

/// `第五条`, `第12條`, `第三章`
fn is_article_head(chars: &[char]) -> bool {
    let [ARTICLE_PREFIX, rest @ ..] = chars else {
        return false;
    };
    let Some(number_len) = rest.iter().position(|ch| ARTICLE_UNITS.contains(ch)) else {
        return false;
    };
    let number = &rest[..number_len];
    (1..=MAX_ARTICLE_NUMBER_CHARS).contains(&number_len)
        && (number.iter().all(char::is_ascii_digit)
            || number.iter().all(|ch| HAN_NUMERALS.contains(ch)))
}

/// 번호: ASCII 숫자 1~3자, 한자 수사 1~3자, `allow_letters`면 영문자 한 자 또는 로마 숫자 1~4자
fn is_label(label: &[char], allow_letters: bool) -> bool {
    let count = label.len();
    let all = |predicate: fn(&char) -> bool| label.iter().all(predicate);
    (count <= MAX_NUMBER_DIGITS && all(char::is_ascii_digit))
        || (count <= MAX_HAN_NUMERALS && label.iter().all(|ch| HAN_NUMERALS.contains(ch)))
        || (allow_letters && count == 1 && all(char::is_ascii_alphabetic))
        || (allow_letters
            && count <= MAX_ROMAN_DIGITS
            && label
                .iter()
                .all(|ch| ROMAN_DIGITS.contains(&ch.to_ascii_lowercase())))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 목록 머리와 아닌 것의 경계: 소수·연도·머리글자·하이픈 낱말은 머리가 아니다.
    #[test]
    fn list_heads_are_told_apart_from_numbers_and_initials() {
        let heads = [
            "1. 下载",
            "12) step",
            "3、步骤",
            "（3）首次",
            "(iv) item",
            "(a) Sign",
            "a) Choose",
            "一、本说明",
            "（二）其他",
            "② 如需",
            "• item",
            "- item",
            "第五条 本软件",
            "第12條 解釋",
            "第三章 附则",
        ];
        let not_heads = [
            "1.5 kg",
            "2026. 10. 13.",
            "A. Smith",
            "co-operation",
            "-5 degrees",
            "第2页",
            "(see the",
            "第 2 页",
            "Wi-Fi",
        ];
        for line in heads {
            assert!(
                starts_with_list_head(line),
                "{line:?} should be a list head"
            );
        }
        for line in not_heads {
            assert!(
                !starts_with_list_head(line),
                "{line:?} should not be a list head"
            );
        }
    }

    /// CJK끼리는 그냥, 라틴이 끼면 공백 하나로, 줄 끝 하이픈 단어는 하이픈째 잇는다.
    #[test]
    fn lines_join_by_script_and_line_end_hyphen() {
        assert_eq!(
            join_lines(["本文出现的名称，", "仅供测试。"]),
            "本文出现的名称，仅供测试。"
        );
        assert_eq!(
            join_lines(["支持 Windows", "和 macOS"]),
            "支持 Windows 和 macOS"
        );
        assert_eq!(
            join_lines(["shared with co-", "operating teams"]),
            "shared with co-operating teams"
        );
        assert_eq!(
            join_lines(["code 123-", "456 printed"]),
            "code 123-456 printed"
        );
        assert_eq!(
            join_lines(["free space -", "(see the table)"]),
            "free space - (see the table)"
        );
        assert_eq!(
            join_lines(["  two   spaces ", "\u{3000}next"]),
            "two spaces next"
        );
    }
}
