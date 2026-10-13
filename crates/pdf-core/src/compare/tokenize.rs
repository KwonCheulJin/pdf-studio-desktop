//! 정규화와 토큰화(계획서 §6.2 2번). 규칙의 정본은 ADR 0001 §9다.
//!
//! - 토큰은 단어다. `glyph`가 없는 글자(pdfium이 만든 공백·줄바꿈)와 공백 글자가 경계이고,
//!   경계가 여럿 이어져도 토큰 하나를 가를 뿐이다(공백·줄바꿈 정리). 쪽 경계는 줄바꿈이다.
//! - 줄 끝 하이픈: 줄 끝 단어가 `-`로 끝나고 그 앞 글자와 다음 줄 첫 글자가 둘 다 글자·숫자면
//!   두 단어를 하이픈째 잇는다(`123-45-` + `67890` → `123-45-67890`). pdfium은 글자 뒤 줄 끝
//!   하이픈을 `PDFIUM_LINE_END_HYPHEN`으로 바꾸고 줄바꿈을 내지 않으므로 하이픈 + 줄바꿈으로
//!   되돌린 뒤 같은 규칙을 쓴다(OCR 글자와 결과가 같다).
//! - 정규화는 클러스터(분해한 글자열에서 결합 순서 0인 글자 + 뒤따르는 결합 글자·한글 중성·종성
//!   자모)마다 한다. 클러스터가 낸 비교 키 글자는 모두 클러스터 원본 글자 상자를 합친 상자를
//!   갖는다(`㈜` → `(주)` 세 글자가 같은 상자). 그래서 키 글자 수와 상자 수가 늘 같다.

use std::ops::RangeInclusive;

use serde::Serialize;
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::{
    canonical_combining_class, decompose_canonical, decompose_compatible,
};

use super::extract::ExtractedPage;
use super::model::TextBox;

/// 텍스트 레이어 쪽에서 대체 문자(U+FFFD)·PUA 글자 비율이 이 값 이상이면 `LowTextConfidence`다.
///
/// 분모는 `glyph`가 있고 공백이 아닌 글자다. ToUnicode가 깨진 글꼴은 그 글꼴로 쓴 글자를 거의
/// 모두 PUA·U+FFFD로 내므로 본문 글꼴이 깨지면 비율이 1에 가깝다. 정상 문서도 기호 글꼴
/// (체크박스·글머리표)이 PUA로 나오지만 줄마다 한두 글자라 보통 몇 % 안이다(실제 문서로 잰 값이
/// 아닌 추정). 10%면 한글 단어(3~4자) 서너 개 중 하나에 깨진 글자가 끼어 비교 결과를 믿기 어렵다.
pub const LOW_TEXT_CONFIDENCE_RATIO: f32 = 0.1;

/// pdfium이 줄 끝 하이픈(앞 글자가 문자인 `-`·U+00AD)을 다음 줄과 이을 때 하이픈 자리에 내는
/// 값(`FPDFText_IsHyphen`인 글자). 상자는 하이픈 글리프이고 뒤에 줄바꿈 글자를 내지 않는다.
const PDFIUM_LINE_END_HYPHEN: char = '\u{2}';
/// 줄 끝에서 다음 줄과 잇는 하이픈(하이픈-마이너스, U+2010 HYPHEN)
const HYPHENS: [char; 2] = ['-', '\u{2010}'];
const HYPHEN: char = '-';
const LINE_BREAKS: [char; 2] = ['\r', '\n'];
/// 사용 영역(PUA): BMP, 15·16 평면
const PRIVATE_USE_RANGES: [RangeInclusive<char>; 3] = [
    '\u{E000}'..='\u{F8FF}',
    '\u{F0000}'..='\u{FFFFD}',
    '\u{100000}'..='\u{10FFFD}',
];
/// 결합 순서가 0이어도 앞 글자와 합쳐지는 한글 중성·종성 자모(옛한글 확장 포함)
const HANGUL_JAMO_CONTINUATION: [RangeInclusive<char>; 2] =
    ['\u{1160}'..='\u{11FF}', '\u{D7B0}'..='\u{D7FF}'];

/// 비교 키의 유니코드 정규화 형식
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum UnicodeForm {
    #[default]
    Nfc,
    /// 호환 문자까지 바꾼다(전각 숫자 → ASCII, `㈜` → `(주)`).
    Nfkc,
}

/// 비교 키를 만드는 옵션. 원문(`Token::text`)에는 적용하지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct NormalizeOptions {
    pub form: UnicodeForm,
    /// 비교 키를 소문자로 바꾼다.
    pub ignore_case: bool,
}

/// 비교 단위(단어). 공백을 품지 않고 비어 있지 않다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    /// 비교 키: 옵션의 정규화 형식, `ignore_case`면 소문자. diff는 이 값만 본다.
    pub key: String,
    /// 원문: NFC만 적용하고 대소문자를 그대로 둔 글자(`Placement::Boxes`의 `text` 재료)
    pub text: String,
    /// `key`의 글자마다 하나(같은 순서). 그 글자를 낸 원본 글자(클러스터)의 상자이고, 쪽은
    /// 상자의 `page`다. 하이픈으로 이은 토큰은 쪽이 바뀔 수 있다.
    pub key_boxes: Vec<TextBox>,
    /// OCR 글자 신뢰도의 최솟값(0~1). OCR 글자가 하나라도 들면 OCR 토큰이고, 텍스트 레이어
    /// 글자만이면 `None`이다(직렬화하지 않는다).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

/// 쪽들의 글자를 이어 토큰열로 만든다. 쪽은 받은 순서대로 잇고 쪽 사이는 줄바꿈으로 본다.
pub fn tokenize(pages: &[ExtractedPage], options: NormalizeOptions) -> Vec<Token> {
    tokenize_pages(pages, options, |_| {})
}

/// [`tokenize`]와 같다. 쪽마다 그 쪽까지의 토큰을 만든 뒤 `on_page(끝낸 쪽 수)`를 부른다(진행률).
/// 쪽의 마지막 단어는 다음 쪽 첫 단어와 하이픈으로 이어질 수 있어 다음 쪽을 읽은 뒤 토큰으로 만든다.
pub(super) fn tokenize_pages(
    pages: &[ExtractedPage],
    options: NormalizeOptions,
    mut on_page: impl FnMut(usize),
) -> Vec<Token> {
    let mut words = Words::default();
    let mut tokens = Vec::new();
    for (index, page) in pages.iter().enumerate() {
        for extracted in &page.chars {
            match extracted.glyph {
                None => words.boundary(is_line_break(extracted.ch)),
                Some(_) if extracted.ch.is_whitespace() => {
                    words.boundary(is_line_break(extracted.ch));
                }
                Some(glyph) if extracted.ch == PDFIUM_LINE_END_HYPHEN => {
                    words.push(HYPHEN, glyph.bounds, extracted.confidence);
                    words.boundary(true);
                }
                Some(glyph) => words.push(extracted.ch, glyph.bounds, extracted.confidence),
            }
        }
        words.boundary(true);
        // 이어질 수 있는 것은 마지막 단어뿐이다(`Words::boundary`는 그것만 고친다).
        let kept = usize::from(index + 1 < pages.len());
        let ready = words.finished.len().saturating_sub(kept);
        tokens.extend(
            words
                .finished
                .drain(..ready)
                .map(|word| to_token(&word.chars, options)),
        );
        on_page(index + 1);
    }
    tokens
}

/// 텍스트 레이어 글자 중 대체 문자·PUA 비율이 [`LOW_TEXT_CONFIDENCE_RATIO`] 이상인가
pub fn has_low_text_confidence(page: &ExtractedPage) -> bool {
    let (mut counted, mut unreliable) = (0_u32, 0_u32);
    for extracted in &page.chars {
        if extracted.glyph.is_some() && !extracted.ch.is_whitespace() {
            counted += 1;
            if is_unreliable(extracted.ch) {
                unreliable += 1;
            }
        }
    }
    // 나눗셈으로 비교해야 `1 / 10`이 상수 0.1과 같은 f32로 반올림된다.
    counted > 0 && unreliable as f32 / counted as f32 >= LOW_TEXT_CONFIDENCE_RATIO
}

fn is_unreliable(ch: char) -> bool {
    ch == char::REPLACEMENT_CHARACTER || PRIVATE_USE_RANGES.iter().any(|range| range.contains(&ch))
}

fn is_line_break(ch: char) -> bool {
    LINE_BREAKS.contains(&ch)
}

#[derive(Debug, Clone, Copy)]
struct SourceChar {
    ch: char,
    bounds: TextBox,
    confidence: Option<f32>,
}

struct Word {
    chars: Vec<SourceChar>,
    /// 이 단어와 다음 단어 사이에 줄바꿈이 있다.
    line_break_after: bool,
}

#[derive(Default)]
struct Words {
    finished: Vec<Word>,
    current: Vec<SourceChar>,
}

impl Words {
    fn push(&mut self, ch: char, bounds: TextBox, confidence: Option<f32>) {
        self.current.push(SourceChar {
            ch,
            bounds,
            confidence,
        });
    }

    /// 지금 단어를 끝낸다. 줄 끝 하이픈 단어 뒤면 이어 붙인다.
    fn boundary(&mut self, is_line_break: bool) {
        if !self.current.is_empty() {
            let chars = std::mem::take(&mut self.current);
            match self.finished.last_mut() {
                Some(previous) if continues_after_hyphen(previous, &chars) => {
                    previous.chars.extend(chars);
                    previous.line_break_after = false;
                }
                _ => self.finished.push(Word {
                    chars,
                    line_break_after: false,
                }),
            }
        }
        if let Some(last) = self.finished.last_mut() {
            last.line_break_after |= is_line_break;
        }
    }
}

/// `previous`가 줄 끝에서 글자·숫자 + 하이픈으로 끝나고 `next`가 글자·숫자로 시작한다.
fn continues_after_hyphen(previous: &Word, next: &[SourceChar]) -> bool {
    let [.., before_hyphen, hyphen] = previous.chars.as_slice() else {
        return false;
    };
    previous.line_break_after
        && HYPHENS.contains(&hyphen.ch)
        && before_hyphen.ch.is_alphanumeric()
        && next.first().is_some_and(|first| first.ch.is_alphanumeric())
}

fn to_token(chars: &[SourceChar], options: NormalizeOptions) -> Token {
    let text = normalize(chars, UnicodeForm::Nfc)
        .into_iter()
        .map(|source| source.ch)
        .collect();
    let mut key = String::new();
    let mut key_boxes = Vec::new();
    for source in normalize(chars, options.form) {
        if options.ignore_case {
            for lower in source.ch.to_lowercase() {
                key.push(lower);
                key_boxes.push(source.bounds);
            }
        } else {
            key.push(source.ch);
            key_boxes.push(source.bounds);
        }
    }
    // 정규화는 원본 글자를 버리지 않으므로(모든 원본 글자가 한 클러스터에 든다) 원본 글자로 센다.
    let confidence = chars
        .iter()
        .filter_map(|source| source.confidence)
        .reduce(f32::min);
    Token {
        key,
        text,
        key_boxes,
        confidence,
    }
}

/// 글자마다 분해하고(상자는 원본 글자 것), 클러스터마다 다시 합성한다. 합성 결과 글자는 모두
/// 클러스터 상자들을 합친 상자를 갖는다.
fn normalize(chars: &[SourceChar], form: UnicodeForm) -> Vec<SourceChar> {
    let mut decomposed = Vec::with_capacity(chars.len());
    for source in chars {
        let mut emit = |ch| {
            decomposed.push(SourceChar {
                ch,
                bounds: source.bounds,
                confidence: source.confidence,
            });
        };
        match form {
            UnicodeForm::Nfc => decompose_canonical(source.ch, &mut emit),
            UnicodeForm::Nfkc => decompose_compatible(source.ch, &mut emit),
        }
    }
    let mut normalized = Vec::with_capacity(decomposed.len());
    for cluster in decomposed.chunk_by(|_, next| !starts_cluster(next.ch)) {
        let Some((first, rest)) = cluster.split_first() else {
            continue;
        };
        let bounds = rest.iter().fold(first.bounds, |covered, source| {
            union(covered, source.bounds)
        });
        let composed: String = cluster.iter().map(|source| source.ch).collect();
        let confidence = cluster
            .iter()
            .filter_map(|source| source.confidence)
            .reduce(f32::min);
        normalized.extend(composed.nfc().map(|ch| SourceChar {
            ch,
            bounds,
            confidence,
        }));
    }
    normalized
}

fn starts_cluster(ch: char) -> bool {
    canonical_combining_class(ch) == 0
        && !HANGUL_JAMO_CONTINUATION
            .iter()
            .any(|range| range.contains(&ch))
}

/// 두 상자를 덮는 상자. 쪽은 `first` 쪽이다(클러스터·같은 줄 상자처럼 같은 쪽 상자만 합친다).
pub(super) fn union(first: TextBox, second: TextBox) -> TextBox {
    let (left, bottom) = (first.x.min(second.x), first.y.min(second.y));
    let right = (first.x + first.w).max(second.x + second.w);
    let top = (first.y + first.h).max(second.y + second.h);
    TextBox {
        page: first.page,
        x: left,
        y: bottom,
        w: right - left,
        h: top - bottom,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compare::extract::{ExtractedChar, Glyph};
    use crate::compare::model::PageSize;
    use crate::info::{PageBox, PageRotation};

    const GLYPH_WIDTH: f32 = 10.0;
    const GLYPH_HEIGHT: f32 = 12.0;

    /// 글자마다 오른쪽으로 한 칸씩 놓은 쪽. 공백은 pdfium이 만든 글자(`glyph: None`)다.
    fn page(text: &str) -> ExtractedPage {
        let chars = (0_u16..)
            .zip(text.chars())
            .map(|(index, ch)| ExtractedChar {
                ch,
                glyph: (!ch.is_whitespace()).then(|| Glyph {
                    bounds: TextBox {
                        page: 0,
                        x: f32::from(index) * GLYPH_WIDTH,
                        y: 0.0,
                        w: GLYPH_WIDTH,
                        h: GLYPH_HEIGHT,
                    },
                    font_size: GLYPH_HEIGHT,
                }),
                confidence: None,
            })
            .collect();
        ExtractedPage {
            size: PageSize {
                view_box: PageBox {
                    left: 0.0,
                    bottom: 0.0,
                    right: 1000.0,
                    top: 1000.0,
                },
                rotation: PageRotation::Degrees0,
            },
            chars,
            needs_ocr: false,
        }
    }

    /// 자모로 풀어 쓴 한글(ㄱ + ㅏ)은 NFC 키 한 글자가 되고, 그 글자의 상자는 두 자모 상자를 덮는다.
    #[test]
    fn decomposed_hangul_becomes_one_key_char_covering_its_jamo() {
        let tokens = tokenize(&[page("\u{1100}\u{1161}")], NormalizeOptions::default());

        let [token] = tokens.as_slice() else {
            panic!("expected one token, got {tokens:?}");
        };
        assert_eq!(token.key, "가");
        assert_eq!(token.text, "가");
        assert_eq!(
            token.key_boxes,
            vec![TextBox {
                page: 0,
                x: 0.0,
                y: 0.0,
                w: 2.0 * GLYPH_WIDTH,
                h: GLYPH_HEIGHT,
            }]
        );
    }

    /// 분모는 글리프가 있는 공백 아닌 글자다. 10글자 중 PUA 1개(10%)는 대상, 11글자 중
    /// U+FFFD 1개(9.1%)는 대상이 아니다.
    #[test]
    fn low_text_confidence_counts_only_drawn_non_space_chars() {
        assert!(has_low_text_confidence(&page(
            "갑을병정무 기경신임\u{E000}"
        )));
        assert!(!has_low_text_confidence(&page(
            "갑을병정무 기경신임계\u{FFFD}"
        )));
    }
}
