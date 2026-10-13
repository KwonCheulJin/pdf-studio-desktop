//! 용어집(ADR 0002 §4 "용어집", §10 "용어집 정규화", 계획서 §9.1.2 "용어집").
//!
//! - 정규화(프론트와 같다): 원어·번역어 앞뒤 공백을 지우고 NFC. 어느 쪽이든 빈 용어는 버린다.
//!   같은 원어가 둘이면 앞의 것을 쓴다(프론트가 문서별 용어를 공용 용어 앞에 둔다).
//! - 나오는지: NFC 부분 문자열이고 ASCII 글자만 대소문자를 무시한다.
//! - 개수·글자 수 상한(`MAX_GLOSSARY_TERMS`)은 계약 입력 검사라 Step 41이 오류 코드와 함께 둔다.

use std::collections::HashSet;

use unicode_normalization::UnicodeNormalization;

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
