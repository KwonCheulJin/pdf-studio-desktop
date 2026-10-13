//! 용어집(ADR 0002 §4 "용어집", §10 "용어집 정규화", 계획서 §9.1.2 "용어집").
//!
//! - 정규화(프론트와 같다): 원어·번역어 앞뒤 공백을 지우고 NFC. 어느 쪽이든 빈 용어는 버린다.
//!   같은 원어가 둘이면 앞의 것을 쓴다(프론트가 문서별 용어를 공용 용어 앞에 둔다).
//! - 나오는지: NFC 부분 문자열이고 ASCII 글자만 대소문자를 무시한다.
//! - 개수·글자 수 상한([`MAX_GLOSSARY_TERMS`]·[`MAX_GLOSSARY_TERM_CHARS`])은 정규화한 용어로 센다. 넘으면 계약
//!   입력 오류다(`src-tauri`가 `GLOSSARY_TOO_LARGE`로 거부한다. 화면이 먼저 막는다).

use std::collections::HashSet;

use unicode_normalization::UnicodeNormalization;

/// 용어 수 상한(ADR 0002 §10 "용어집 정규화"). 제품명·고유명사를 적는 표라 수백 개면 넉넉하다. 아래 글자 수
/// 상한과 함께 요청 입력을 Haiku 5.5의 낮은 요금 구간(프롬프트 100,000토큰 이하, `models.rs`) 안에 둔다: 용어집
/// 전체를 싣는 스캔 묶음도 500개 × 원어·번역어 40자씩 = 40,000자를 글자당 2토큰(한자·한글을 이 앱의 예상 식
/// 1.3·1.0보다 넉넉히)으로 보고 줄마다 틀 3토큰을 더해 81,500토큰, 고정 부담 600 + 가장 큰 그림(1568px 정사각형
/// ⌈1568/28⌉² = 3,136)을 더해도 약 85,000토큰이다.
pub const MAX_GLOSSARY_TERMS: usize = 500;

/// 원어·번역어 하나의 글자 수(앞뒤 공백을 지운 NFC 유니코드 스칼라 값) 상한. 근거는 [`MAX_GLOSSARY_TERMS`].
pub const MAX_GLOSSARY_TERM_CHARS: usize = 40;

/// 용어집이 상한을 넘었다(`GLOSSARY_TOO_LARGE`). 용어 글은 담지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("용어집이 상한을 넘었다")]
pub struct GlossaryTooLarge;

/// 용어 하나(계약 `GlossaryTerm`)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlossaryTerm {
    pub source: String,
    pub target: String,
}

/// 정규화한 용어집. 순서는 받은 순서(버린 용어를 뺀)다.
#[derive(Debug, Clone, Default)]
pub struct Glossary {
    terms: Vec<GlossaryTerm>,
    /// `terms[i].source`의 ASCII 소문자(나오는지 볼 때 쓴다)
    match_keys: Vec<String>,
}

impl Glossary {
    /// 문서별 + 공용을 합친 목록(프론트가 문서별을 앞에 둔다)을 정규화한다.
    pub fn new(terms: impl IntoIterator<Item = GlossaryTerm>) -> Self {
        let mut seen = HashSet::new();
        let mut glossary = Self::default();
        for term in terms {
            let source = normalize(&term.source);
            let target = normalize(&term.target);
            if source.is_empty() || target.is_empty() || !seen.insert(source.clone()) {
                continue;
            }
            glossary.match_keys.push(source.to_ascii_lowercase());
            glossary.terms.push(GlossaryTerm { source, target });
        }
        glossary
    }

    pub fn terms(&self) -> &[GlossaryTerm] {
        &self.terms
    }

    /// 정규화한 용어 수와 원어·번역어 글자 수가 상한 안인가
    pub fn check_limits(&self) -> Result<(), GlossaryTooLarge> {
        let within_chars = |text: &str| text.chars().count() <= MAX_GLOSSARY_TERM_CHARS;
        let within = self.terms.len() <= MAX_GLOSSARY_TERMS
            && self
                .terms
                .iter()
                .all(|term| within_chars(&term.source) && within_chars(&term.target));
        if within {
            Ok(())
        } else {
            Err(GlossaryTooLarge)
        }
    }

    /// `text`(NFC)에 원어가 나오는 용어의 색인(용어집 순서)
    pub(crate) fn indices_in<'a>(&'a self, text: &str) -> impl Iterator<Item = usize> + 'a {
        let haystack = text.to_ascii_lowercase();
        self.match_keys
            .iter()
            .enumerate()
            .filter(move |(_, key)| haystack.contains(key.as_str()))
            .map(|(index, _)| index)
    }
}

/// `term`의 원어가 `text`(NFC)에 나오는가(`Glossary::indices_in`과 같은 규칙). 나눠 보내는 요청이
/// 그 항목에 나오는 용어만 싣는 데 쓴다.
pub(crate) fn term_appears_in(term: &GlossaryTerm, text: &str) -> bool {
    text.to_ascii_lowercase()
        .contains(&term.source.to_ascii_lowercase())
}

fn normalize(text: &str) -> String {
    text.trim().nfc().collect()
}
