//! 예상 토큰·`max_tokens`·예상 요금 golden(ADR 0002 §4). 기대값은 상수(근거는 `chunk.rs`·`models.rs`
//! 주석)로 손으로 셈한 리터럴이다. 비율 상수·요금을 고치면(Step 39·48) 다시 센다.

use translate::{
    Chunk, ChunkEstimate, Glossary, GlossaryTerm, Language, ScanImage, SourcePage,
    SourcePageContent, SourceParagraph, TranslateModel, build_chunks, estimated_cost_micro_usd,
};

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

fn estimates(pages: &[SourcePage], glossary: &Glossary, language: Language) -> Vec<ChunkEstimate> {
    build_chunks(pages, glossary, language, true)
        .into_iter()
        .map(|chunk| match chunk {
            Chunk::Text(text) => text.estimate,
            Chunk::Scan(scan) => scan.estimate,
        })
        .collect()
}

fn estimate(input_tokens: u32, output_tokens: u32) -> ChunkEstimate {
    ChunkEstimate {
        input_tokens,
        output_tokens,
    }
}

/// 텍스트 묶음: 입력 = 1,100 + 항목 글 토큰 + 실은 용어 토큰, 출력 = 항목 글 토큰 × 언어 비율 + 항목 수 × 12.
///
/// - `本协议适用于 Model X200 的软件。`: 한자 9 × 1.3 + 낱말 2(Model, X) × 1.4 + 그 밖 4(2·0·0·。)
///   = 18.5 → 19
/// - `Install the SDK first.`: 낱말 4 × 1.4 + 그 밖 1 = 6.6 → 7
/// - 실은 용어: 协议(2.6 → 3) + 계약(2) = 5, sdk(1.4 → 2) + 개발 키트(공백 빼고 4) = 6. 密码는 나오지 않는다.
/// - 입력 1,100 + 19 + 7 + 5 + 6 = 1,137. 출력 ⌈26 × 1.5⌉ + 2 × 12 = 63(중국어), 26 × 2.0 + 2 × 12 = 76(영어)
#[test]
fn text_chunk_estimate_counts_overhead_text_and_glossary_tokens() {
    let pages = [text_page(
        0,
        &["本协议适用于 Model X200 的软件。", "Install the SDK first."],
    )];
    let glossary = Glossary::new([
        term("协议", "계약"),
        term("密码", "비밀번호"),
        term("sdk", "개발 키트"),
    ]);

    assert_eq!(
        estimates(&pages, &glossary, Language::Zh),
        vec![estimate(1_137, 63)]
    );
    assert_eq!(
        estimates(&pages, &glossary, Language::En),
        vec![estimate(1_137, 76)]
    );
}

/// 스캔 묶음: 입력 = 1,100 + 그림 토큰 ⌈w/28⌉ × ⌈h/28⌉ + 용어집 전체 토큰, 출력 = 쪽당 3,500.
/// 1568 × 1109(A4 세로) = 56 × 40 = 2,240(ADR 0002 §4), 29 × 28 = 2 × 1 = 2(올림)
#[test]
fn scan_chunk_estimate_counts_image_patches_and_the_whole_glossary() {
    let pages = [scan_page(4, 1568, 1109), scan_page(5, 29, 28)];
    let glossary = Glossary::new([term("协议", "계약")]);

    assert_eq!(
        estimates(&pages, &glossary, Language::Zh),
        vec![
            estimate(1_100 + 2240 + 5, 3500),
            estimate(1_100 + 2 + 5, 3500)
        ]
    );
}

/// `max_tokens` = min(max(출력 × 2 + 200, 1024), 모델 출력 상한 128,000)
#[test]
fn max_tokens_doubles_the_output_estimate_within_floor_and_model_limit() {
    let cases = [(1_000, 2_200), (10, 1_024), (100_000, 128_000)];

    for (output_tokens, want) in cases {
        for model in [TranslateModel::Sonnet, TranslateModel::Haiku] {
            assert_eq!(
                estimate(0, output_tokens).max_tokens(model),
                want,
                "{model:?} 출력 {output_tokens}"
            );
        }
    }
}

/// 요금 = ⌈(입력 × 입력 단가 + 출력 × 출력 단가) / 1,000,000⌉ micro-USD, `u32`로 넘치면 `u32::MAX`.
/// Sonnet 2,000,000·10,000,000, Haiku 100,000·500,000(1M 토큰당 micro-USD)
#[test]
fn estimated_cost_rounds_up_to_whole_micro_usd_and_saturates() {
    // 1234 × 2 + 5678 × 10 = 59,248
    assert_eq!(
        estimated_cost_micro_usd(1_234, 5_678, TranslateModel::Sonnet),
        59_248
    );
    // (3 × 100,000 + 3 × 500,000) / 1,000,000 = 1.8 → 2
    assert_eq!(estimated_cost_micro_usd(3, 3, TranslateModel::Haiku), 2);
    assert_eq!(
        estimated_cost_micro_usd(u64::MAX, 0, TranslateModel::Sonnet),
        u32::MAX
    );
}

/// 실제 API 실측(2026-10-13, Haiku·Sonnet, 쪽 1, 묶음 하나, 용어집 없음)의 `usage`와 같은 입력의 예상. 입력의 예상
/// 글 토큰(문단 합)은 중국어 531(문단 15), 영어 257(문단 12)이다. 한글 한 글자는 글 토큰 1이라 같은 합을 만든다.
struct LiveRun {
    language: Language,
    paragraphs: usize,
    text_tokens: usize,
    actual_input: u32,
    actual_output: u32,
}

const LIVE_RUNS: [LiveRun; 3] = [
    // zh Haiku
    LiveRun {
        language: Language::Zh,
        paragraphs: 15,
        text_tokens: 531,
        actual_input: 1_375,
        actual_output: 947,
    },
    // en Haiku
    LiveRun {
        language: Language::En,
        paragraphs: 12,
        text_tokens: 257,
        actual_input: 1_145,
        actual_output: 622,
    },
    // zh Sonnet(입력은 모델과 무관, 출력만 다르다)
    LiveRun {
        language: Language::Zh,
        paragraphs: 15,
        text_tokens: 531,
        actual_input: 1_375,
        actual_output: 955,
    },
];

/// 실측 뒤 `PROMPT_VERSION` 2에서 system에 더한 규칙 둘(한국어 약 80글자)의 토큰 상한. 입력 예상은 실측 `usage`에
/// 이만큼을 더한 값 이상이어야 한다(재측정 전까지 이 여유로 보증).
const PROMPT_RULES_TOKENS_UPPER_BOUND: u32 = 120;

/// 글 토큰 합이 `text_tokens`인 한글 문단 `paragraphs`개(나머지는 마지막 문단에 붙인다)
fn paragraphs_with_tokens(text_tokens: usize, paragraphs: usize) -> Vec<String> {
    let each = text_tokens / paragraphs;
    let rest = text_tokens % paragraphs;
    (0..paragraphs)
        .map(|index| "가".repeat(each + if index + 1 == paragraphs { rest } else { 0 }))
        .collect()
}

/// 실측한 세 번 모두에서 예상이 실제 `usage`보다 작지 않다(예상 요금이 실제보다 작게 나오지 않는다).
#[test]
fn estimates_are_not_below_the_live_measured_usage() {
    for run in LIVE_RUNS {
        let texts = paragraphs_with_tokens(run.text_tokens, run.paragraphs);
        let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        let pages = [text_page(0, &refs)];

        let chunks = estimates(&pages, &Glossary::default(), run.language);

        assert_eq!(chunks.len(), 1, "{:?}", run.language);
        assert!(
            chunks[0].input_tokens >= run.actual_input + PROMPT_RULES_TOKENS_UPPER_BOUND,
            "{:?} 입력 예상 {} < 실제 {} + 규칙 {}",
            run.language,
            chunks[0].input_tokens,
            run.actual_input,
            PROMPT_RULES_TOKENS_UPPER_BOUND
        );
        assert!(
            chunks[0].output_tokens >= run.actual_output,
            "{:?} 출력 예상 {} < 실제 {}",
            run.language,
            chunks[0].output_tokens,
            run.actual_output
        );
    }
}
