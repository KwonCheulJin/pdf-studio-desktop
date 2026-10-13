//! 용어집 정규화(ADR 0002 §10): 앞뒤 공백·NFC, 빈 용어 버림, 같은 원어는 앞의 것(문서별 우선).
//! 상한(개수·글자 수)은 정규화한 용어로 센다.

use translate::{
    Chunk, Glossary, GlossaryTerm, GlossaryTooLarge, Language, MAX_GLOSSARY_TERM_CHARS,
    MAX_GLOSSARY_TERMS, SourcePage, SourcePageContent, SourceParagraph, build_chunks,
};

fn term(source: &str, target: &str) -> GlossaryTerm {
    GlossaryTerm {
        source: source.to_owned(),
        target: target.to_owned(),
    }
}

#[test]
fn terms_are_trimmed_nfc_normalized_and_empty_or_repeated_sources_are_dropped() {
    let glossary = Glossary::new([
        term(" 甲方 ", "\t갑 "),
        term("e\u{301}tude", "에튀드"),
        term("", "빈 원어"),
        term("乙方", "   "),
        // 문서별(앞) 다음에 온 공용 용어의 같은 원어는 버린다(정규화한 뒤 비교)
        term("甲方", "공용 번역어"),
        term("\u{e9}tude", "공용 번역어"),
    ]);

    assert_eq!(
        glossary.terms(),
        [term("甲方", "갑"), term("\u{e9}tude", "에튀드")]
    );
}

/// NFD로 들어온 원어도 NFC 원문(ADR 0002 §2)에서 찾는다.
#[test]
fn nfd_source_matches_nfc_paragraph_text() {
    let glossary = Glossary::new([term("e\u{301}tude", "에튀드")]);
    let page = SourcePage {
        page: 0,
        content: SourcePageContent::Text(vec![SourceParagraph {
            number: 1,
            text: "Read the \u{e9}tude.".to_owned(),
            heading: false,
        }]),
    };

    let chunks = build_chunks(&[page], &glossary, Language::En, false);

    let [Chunk::Text(chunk)] = chunks.as_slice() else {
        panic!("텍스트 묶음 하나여야 한다: {chunks:?}");
    };
    assert_eq!(chunk.glossary, [term("\u{e9}tude", "에튀드")]);
}

/// 개수는 정규화(빈 용어·같은 원어를 버린) 뒤의 용어 수로 센다. 프론트가 문서별 + 공용을 합쳐 보내므로
/// 겹친 원어는 상한에 들지 않는다.
#[test]
fn term_limit_counts_normalized_terms() {
    let terms: Vec<GlossaryTerm> = (0..MAX_GLOSSARY_TERMS)
        .map(|index| term(&format!("原词{index}"), "번역어"))
        .collect();
    let with_repeated_source = terms
        .iter()
        .cloned()
        .chain([term(" 原词0 ", "공용 번역어"), term("", "빈 원어")]);
    let one_more = terms.iter().cloned().chain([term("新词", "새 용어")]);

    assert_eq!(Glossary::new(with_repeated_source).check_limits(), Ok(()));
    assert_eq!(
        Glossary::new(one_more).check_limits(),
        Err(GlossaryTooLarge)
    );
}

/// 글자 수는 원어·번역어마다 앞뒤 공백을 지운 NFC 글자(유니코드 스칼라 값)로 센다.
#[test]
fn character_limit_applies_to_each_trimmed_source_and_target() {
    let at_limit = "甲".repeat(MAX_GLOSSARY_TERM_CHARS);
    let over_limit = "甲".repeat(MAX_GLOSSARY_TERM_CHARS + 1);
    let padded = format!("  {at_limit}  ");
    // NFD `e` + U+0301 두 글자는 NFC로 `é` 한 글자다.
    let decomposed = format!("{}e\u{301}", "a".repeat(MAX_GLOSSARY_TERM_CHARS - 1));

    for accepted in [
        term(&padded, "번역어"),
        term("原词", &padded),
        term(&decomposed, "번역어"),
    ] {
        assert_eq!(Glossary::new([accepted]).check_limits(), Ok(()));
    }
    for rejected in [term(&over_limit, "번역어"), term("原词", &over_limit)] {
        assert_eq!(
            Glossary::new([rejected]).check_limits(),
            Err(GlossaryTooLarge)
        );
    }
}
