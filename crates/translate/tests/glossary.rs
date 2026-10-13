//! 용어집 정규화(ADR 0002 §10): 앞뒤 공백·NFC, 빈 용어 버림, 같은 원어는 앞의 것(문서별 우선).

use translate::{
    Chunk, Glossary, GlossaryTerm, Language, SourcePage, SourcePageContent, SourceParagraph,
    build_chunks,
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
