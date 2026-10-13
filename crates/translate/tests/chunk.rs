//! 묶음 golden(ADR 0002 §4): 문단을 자르지 않음, 상한, 긴 문단 문장 나눔, 순서, 스캔 쪽 한 묶음,
//! 묶음에 나온 용어만.
//!
//! 기대값은 상수로 손으로 셈한 리터럴이다(상한 2,500, 고정 부담 1,100 → 문단 글 토큰 자리 1,400).
//! 글 토큰: 한자 ×1.3, 라틴 낱말 ×1.4, 그 밖 글자(공백 제외) ×1.0, 올림. 출력: 중국어 ×1.5, 올림,
//! 여기에 항목(문단·조각)마다 12.
//! 비율 상수를 고치면(Step 48) 이 값들을 다시 센다.

use translate::{
    Chunk, ChunkEstimate, ChunkItem, Fragment, Glossary, GlossaryTerm, Language, ScanImage,
    SourcePage, SourcePageContent, SourceParagraph, TextChunk, build_chunks,
};

/// 한자 `count`개. 글 토큰은 ⌈count × 1.3⌉이다.
fn han(count: usize) -> String {
    "文".repeat(count)
}

fn text_page(page: u32, texts: &[&str]) -> SourcePage {
    let paragraphs = texts
        .iter()
        .zip(1..)
        .map(|(text, number)| SourceParagraph {
            number,
            text: (*text).to_owned(),
            heading: false,
        })
        .collect();
    SourcePage {
        page,
        content: SourcePageContent::Text(paragraphs),
    }
}

fn scan_page(page: u32, width_px: u32, height_px: u32) -> SourcePage {
    SourcePage {
        page,
        content: SourcePageContent::Scan(ScanImage {
            width_px,
            height_px,
        }),
    }
}

fn term(source: &str, target: &str) -> GlossaryTerm {
    GlossaryTerm {
        source: source.to_owned(),
        target: target.to_owned(),
    }
}

fn item(page: u32, number: u32, text: &str) -> ChunkItem {
    ChunkItem {
        page,
        number,
        text: text.to_owned(),
        fragment: None,
    }
}

fn fragment(page: u32, number: u32, text: &str, index: u32, count: u32) -> ChunkItem {
    ChunkItem {
        fragment: Some(Fragment { index, count }),
        ..item(page, number, text)
    }
}

fn text_chunk(items: Vec<ChunkItem>, input_tokens: u32, output_tokens: u32) -> Chunk {
    Chunk::Text(TextChunk {
        items,
        glossary: Vec::new(),
        estimate: ChunkEstimate {
            input_tokens,
            output_tokens,
        },
    })
}

fn chunks_zh(pages: &[SourcePage]) -> Vec<Chunk> {
    build_chunks(pages, &Glossary::default(), Language::Zh, true)
}

/// 쪽 경계를 넘어 담고, 입력 예상이 상한과 같으면 담고 넘으면 닫는다. 문단 글은 그대로다.
#[test]
fn paragraphs_fill_a_chunk_up_to_the_budget_across_pages_without_splitting() {
    let (a, b, c, d) = (han(1000), format!("{}。", han(76)), han(1), han(10));
    let pages = [text_page(0, &[&a, &b]), text_page(1, &[&c, &d])];

    // b: ⌈98.8 + 1⌉ = 100. 1100 + 1300 + 100 = 2500(상한과 같아 담는다) → 2 토큰을 더하면 2502라 닫는다.
    // 첫째 출력 ⌈1400 × 1.5⌉ + 2 × 12 = 2124. 두 번째: 1100 + 2 + 13 = 1115, 출력 ⌈15 × 1.5⌉ + 2 × 12 = 47
    assert_eq!(
        chunks_zh(&pages),
        vec![
            text_chunk(vec![item(0, 1, &a), item(0, 2, &b)], 2500, 2124),
            text_chunk(vec![item(1, 1, &c), item(1, 2, &d)], 1115, 47),
        ]
    );
}

/// 문단 하나만으로 상한을 넘으면 열린 묶음을 닫고, 문장 끝(닫는 괄호까지)에서 나눈 문장을 상한까지
/// 채운 조각마다 묶음 하나를 낸다. 뒤 문단은 새 묶음에서 시작한다.
#[test]
fn long_paragraph_is_split_at_sentence_ends_into_one_chunk_per_fragment() {
    let short = han(10);
    let first = format!("{}。", han(500)); // 651
    let second = format!("{}。」", han(499)); // ⌈648.7 + 2⌉ = 651
    let third = format!("{}！", han(200)); // 261
    let long = format!("{first}{second} {third}"); // ⌈1562.7⌉ = 1563 > 1400
    let pages = [text_page(0, &[&short, &long, &short])];

    // 조각 0 = 첫째 + 둘째: ⌈1301.7⌉ = 1302(셋째까지면 1563이라 넘는다). 조각 1 = 셋째(앞 공백 지움).
    // 출력: ⌈13 × 1.5⌉ + 12 = 32, ⌈1302 × 1.5⌉ + 12 = 1965, ⌈261 × 1.5⌉ + 12 = 404
    assert_eq!(
        chunks_zh(&pages),
        vec![
            text_chunk(vec![item(0, 1, &short)], 1113, 32),
            text_chunk(
                vec![fragment(0, 2, &format!("{first}{second}"), 0, 2)],
                2402,
                1965
            ),
            text_chunk(vec![fragment(0, 2, &third, 1, 2)], 1361, 404),
            text_chunk(vec![item(0, 3, &short)], 1113, 32),
        ]
    );
}

/// 문장 끝이 없는 긴 글은 글 토큰이 상한 안인 만큼씩 글자로 나눈다(⌈1.3n⌉ ≤ 1400 → n ≤ 1076).
#[test]
fn sentence_longer_than_the_budget_is_split_by_characters() {
    let long = han(2000);
    let pages = [text_page(3, &[&long])];

    assert_eq!(
        chunks_zh(&pages),
        vec![
            // ⌈1076 × 1.3⌉ = 1399, 출력 ⌈1399 × 1.5⌉ + 12 = 2111
            text_chunk(vec![fragment(3, 1, &han(1076), 0, 2)], 2499, 2111),
            // ⌈924 × 1.3⌉ = 1202, 출력 ⌈1202 × 1.5⌉ + 12 = 1815
            text_chunk(vec![fragment(3, 1, &han(924), 1, 2)], 2302, 1815),
        ]
    );
}

/// 스캔 옵션을 켜면 스캔 쪽이 열린 텍스트 묶음을 닫고 혼자 묶음이 된다. 끄면 건너뛰고 앞뒤 문단은
/// 한 묶음에 든다.
#[test]
fn scan_page_is_its_own_chunk_only_when_scan_pages_are_included() {
    let short = han(10);
    let pages = [
        text_page(0, &[&short]),
        scan_page(1, 1568, 1109),
        text_page(2, &[&short]),
    ];
    let shape = |chunks: Vec<Chunk>| -> Vec<Vec<(u32, u32)>> {
        chunks
            .into_iter()
            .map(|chunk| match chunk {
                Chunk::Text(text) => text
                    .items
                    .iter()
                    .map(|item| (item.page, item.number))
                    .collect(),
                Chunk::Scan(scan) => vec![(scan.page, 0)],
            })
            .collect()
    };

    let included = build_chunks(&pages, &Glossary::default(), Language::Zh, true);
    let skipped = build_chunks(&pages, &Glossary::default(), Language::Zh, false);

    assert_eq!(
        shape(included),
        vec![vec![(0, 1)], vec![(1, 0)], vec![(2, 1)]]
    );
    assert_eq!(shape(skipped), vec![vec![(0, 1), (2, 1)]]);
}

/// 텍스트 묶음은 항목에 원어가 나오는 용어만(ASCII만 대소문자 무시, 용어집 순서), 스캔 묶음은
/// 용어집 전체를 싣는다.
#[test]
fn text_chunk_carries_only_terms_found_in_its_items_and_scan_chunk_carries_all() {
    let glossary = Glossary::new([
        term("甲方", "갑"),
        term("乙方", "을"),
        term("sdk", "개발 키트"),
        term("Ärger", "분노"),
    ]);
    let pages = [
        text_page(0, &["甲方应安装SDK。"]),
        scan_page(1, 28, 28),
        text_page(2, &["乙方 ärger"]),
    ];

    let glossaries: Vec<Vec<GlossaryTerm>> = build_chunks(&pages, &glossary, Language::Zh, true)
        .into_iter()
        .map(|chunk| match chunk {
            Chunk::Text(text) => text.glossary,
            Chunk::Scan(scan) => scan.glossary,
        })
        .collect();

    assert_eq!(
        glossaries,
        vec![
            vec![term("甲方", "갑"), term("sdk", "개발 키트")],
            vec![
                term("甲方", "갑"),
                term("乙方", "을"),
                term("sdk", "개발 키트"),
                term("Ärger", "분노"),
            ],
            vec![term("乙方", "을")],
        ]
    );
}

/// 실을 용어의 토큰도 상한에 센다: 용어(甲 2 + 갑 1 = 3)가 붙어 2503이 되면 닫는다.
#[test]
fn glossary_tokens_count_toward_the_budget() {
    let a = han(1000);
    let b = format!("甲{}。", han(75)); // 한자 76자 + 문장부호 1 → ⌈98.8 + 1⌉ = 100
    let pages = [text_page(0, &[&a, &b])];
    let glossary = Glossary::new([term("甲", "갑")]);

    let chunks = build_chunks(&pages, &glossary, Language::Zh, true);

    assert_eq!(
        chunks,
        vec![
            text_chunk(vec![item(0, 1, &a)], 2400, 1962),
            Chunk::Text(TextChunk {
                items: vec![item(0, 2, &b)],
                glossary: vec![term("甲", "갑")],
                estimate: ChunkEstimate {
                    input_tokens: 1203,
                    output_tokens: 162,
                },
            }),
        ]
    );
}
