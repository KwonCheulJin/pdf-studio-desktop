//! 묶음과 예상치(ADR 0002 §4, 계획서 §9.1.2 "묶음"·"예상 토큰", Q12). 묶음 하나가 API 요청 하나다.
//! 실행기와 계획(`prepare_translation`)이 같은 [`build_chunks`]로 만든다.
//!
//! - 묶음은 늘 범위 전체로 만든다. 이어하기(기록에 있는 항목을 빼고 보내기)는 실행기가 한다.
//! - 텍스트 묶음: 문서 순서로 문단을 자르지 않고 담는다. 다음 문단을 더하면 입력 예상이
//!   `CHUNK_INPUT_TOKEN_BUDGET`을 넘을 때 닫는다. 쪽 경계는 넘어도 된다.
//! - 긴 문단: 그 문단 하나만 담은 묶음의 입력 예상이 상한을 넘으면 열린 묶음을 닫고 조각으로
//!   나눈다. 문장 끝에서 나눈 문장을 상한까지 채워 조각 하나로 만들고, 문장 하나가 넘치면 그 문장을
//!   글자로 나눈다. 조각 하나가 묶음 하나다.
//! - 스캔 쪽: 옵션이 켜졌으면 열린 텍스트 묶음을 닫고 쪽 하나를 묶음 하나로 낸다. 꺼졌으면 건너뛴다
//!   (텍스트 묶음을 닫지 않는다).
//!
//! 비율 상수는 공식 토크나이저를 쓰지 않는 추정 시작값이다(동의 전에 문서를 보내지 않으려고
//! `count_tokens`를 쓰지 않는다, Q12). Step 48에서 사용자가 실제 번역한 `usage`와 맞춰 고친다.

use std::collections::BTreeSet;
use std::ops::Range;

use crate::glossary::{Glossary, GlossaryTerm};
use crate::language::Language;
use crate::models::TranslateModel;
use crate::per_mille::{PER_MILLE_SCALE, PerMille};
use crate::script::{is_han, is_latin_letter};
use crate::source::{ScanImage, SourcePage, SourcePageContent, SourceParagraph};

/// 묶음 하나의 입력 예상 상한(ADR 0002 §4 시작값). 문단 수십 개가 한 요청에 들어 요청 수를 줄이면서,
/// 응답이 잘리거나 검증에 실패해 나눠 다시 보낼 때 버리는 양을 작게 둔다. 측정 후 조정한다.
const CHUNK_INPUT_TOKEN_BUDGET: u64 = 2_500;

/// 묶음마다 붙는 고정 입력: system 프롬프트(Step 39 문구 380자, 이 파일의 글 토큰 식으로 273) + 출력
/// 스키마(structured outputs가 system에 덧붙이는 스키마 설명, 스키마 JSON이 이 식으로 123이라 약 150으로
/// 잡음) + user 틀(원문 언어 줄·태그·끝 지시, 이 식으로 49)과 여유. 항목마다 붙는 JSON 틀
/// (`{"id":"n","text":""}`, 이 식으로 18)은 세지 않는다. Step 48에서 `usage`로 고친다.
const CHUNK_OVERHEAD_TOKENS: u64 = 600;

/// 한자 하나. Claude 토크나이저는 CJK 글자를 1토큰 남짓으로 나누고(공개 측정 범위 약 1.0~1.5),
/// 최근 토크나이저가 같은 글에 토큰을 더 쓰는 쪽이라 위쪽으로 잡았다(예상 요금이 실제보다 작지
/// 않게).
const TOKENS_PER_HAN_CHAR: PerMille = PerMille(1_300);

/// 라틴 낱말(라틴 글자가 이어진 덩어리) 하나. 영어는 낱말당 약 1.3토큰(≈ 4글자/토큰)이 흔한
/// 어림이고, 한자와 같은 이유로 조금 위로 잡았다.
const TOKENS_PER_LATIN_WORD: PerMille = PerMille(1_400);

/// 그 밖 글자 하나(숫자·문장부호·한글·가나 등, 공백 제외). 숫자·기호는 대개 글자마다 따로 나뉘고,
/// 한글은 음절당 1토큰 안팎으로 본다(용어집 번역어가 여기 든다). 공백은 앞뒤 낱말 토큰에 붙어 세지 않는다.
const TOKENS_PER_OTHER_CHAR: PerMille = PerMille(1_000);

/// 중국어 → 한국어 출력/입력 비율. 한자 한 글자는 한국어로 1.5~2음절(한자어 음절 + 조사·어미)이 되고
/// 한글 음절을 1토큰으로 보면 한자 1.3토큰 대비 약 1.2~1.5배다. 위 끝을 쓴다.
const OUTPUT_TOKENS_PER_INPUT_TOKEN_ZH: PerMille = PerMille(1_500);

/// 영어 → 한국어 출력/입력 비율. 영어 낱말 하나(1.4토큰)가 한국어로 약 2.5~3음절이라 약 2배다.
const OUTPUT_TOKENS_PER_INPUT_TOKEN_EN: PerMille = PerMille(2_000);

/// 그림 토큰 = ⌈가로 / 28⌉ × ⌈세로 / 28⌉(공식 문서 `build-with-claude/vision`, ADR 0002 §15)
const IMAGE_TOKEN_PATCH_PX: u32 = 28;

/// 스캔 쪽 하나의 출력 예상: 받아 적은 원문 + 번역 두 벌. 빽빽한 중국어 A4 쪽(약 1,000자)이면
/// 원문 약 1,300토큰 + 번역 약 1,950토큰 + JSON 틀 ≈ 3,400토큰이라 올려 잡았다. 영어 쪽(약 450낱말)은
/// 약 1,900토큰으로 이보다 작다.
const SCAN_PAGE_OUTPUT_TOKENS: u64 = 3_500;

/// `max_tokens` = 출력 예상 × 이 값(ADR 0002 §4). 비율 상수의 추정 오차를 덮는다.
const MAX_TOKENS_HEADROOM: u64 = 2;

/// 출력 JSON 틀(`{"paragraphs":[…]}`, 항목마다 `{"id":"n","text":"…"}` 약 10토큰)을 덮는 여유.
/// 짧은 항목 20개 정도의 틀이다. 더 많은 짧은 항목이 잘리면 응답 검증이 반으로 나눠 다시 보낸다(§6).
const RESPONSE_OVERHEAD_TOKENS: u64 = 200;

/// `max_tokens`의 아래 끝. 제목 한 줄처럼 짧은 묶음도 번역문이 원문보다 길게 나올 여유를 둔다.
const MIN_MAX_TOKENS: u64 = 1_024;

/// 1M 토큰(모델 표 요금의 단위)
const TOKENS_PER_MTOK: u128 = 1_000_000;

/// 문장 끝 글자(ADR 0002 §4 "긴 문단")
const SENTENCE_TERMINATORS: [char; 6] = ['。', '！', '？', '.', '!', '?'];
/// 문장 끝 바로 뒤에 오면 그 문장에 붙이는 닫는 따옴표·괄호
const SENTENCE_CLOSERS: [char; 15] = [
    '"', '\'', '”', '’', '」', '』', ')', '）', ']', '］', '】', '》', '〉', '〕', '}',
];

/// 묶음 하나 = API 요청 하나
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Chunk {
    Text(TextChunk),
    Scan(ScanChunk),
}

/// 글자층 문단(또는 긴 문단의 조각 하나)을 담은 묶음
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextChunk {
    /// 문서 순서. 요청의 항목 ID는 이 순번(1부터)이다.
    pub items: Vec<ChunkItem>,
    /// 항목 원문에 원어가 나오는 용어(용어집 순서)
    pub glossary: Vec<GlossaryTerm>,
    pub estimate: ChunkEstimate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkItem {
    pub page: u32,
    pub number: u32,
    /// 문단 원문 또는 조각 원문(앞뒤 공백을 지운)
    pub text: String,
    /// 긴 문단을 나눈 조각이면 그 자리. 번역은 조각 순서대로 공백 하나로 잇는다.
    pub fragment: Option<Fragment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fragment {
    /// 0부터
    pub index: u32,
    pub count: u32,
}

/// 스캔 쪽 하나를 담은 묶음
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanChunk {
    pub page: u32,
    pub image: ScanImage,
    /// 원문을 모르므로 용어집 전체
    pub glossary: Vec<GlossaryTerm>,
    pub estimate: ChunkEstimate,
}

/// 묶음 하나의 예상 토큰
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChunkEstimate {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

impl ChunkEstimate {
    /// min(max(출력 예상 × `MAX_TOKENS_HEADROOM` + `RESPONSE_OVERHEAD_TOKENS`, `MIN_MAX_TOKENS`),
    /// 모델 출력 상한)(ADR 0002 §4)
    pub fn max_tokens(&self, model: TranslateModel) -> u32 {
        let wanted = (u64::from(self.output_tokens) * MAX_TOKENS_HEADROOM
            + RESPONSE_OVERHEAD_TOKENS)
            .max(MIN_MAX_TOKENS);
        saturate(wanted.min(u64::from(model.spec().max_output_tokens)))
    }
}

/// 예상 요금(micro-USD) = ⌈(입력 × 입력 단가 + 출력 × 출력 단가) / 1,000,000⌉, `u32`로 넘치면
/// `u32::MAX`(ADR 0002 §4)
pub fn estimated_cost_micro_usd(
    input_tokens: u64,
    output_tokens: u64,
    model: TranslateModel,
) -> u32 {
    let spec = model.spec();
    let cost = (u128::from(input_tokens) * u128::from(spec.input_micro_usd_per_mtok)
        + u128::from(output_tokens) * u128::from(spec.output_micro_usd_per_mtok))
    .div_ceil(TOKENS_PER_MTOK);
    u32::try_from(cost).unwrap_or(u32::MAX)
}

/// 범위 안 쪽(`pages`, 문서 순서)을 묶음으로 나눈다. `language`는 정해진 원문 언어다.
pub fn build_chunks(
    pages: &[SourcePage],
    glossary: &Glossary,
    language: Language,
    include_scan_pages: bool,
) -> Vec<Chunk> {
    let mut builder = ChunkBuilder::new(glossary, language);
    for page in pages {
        match &page.content {
            SourcePageContent::Text(paragraphs) => {
                for paragraph in paragraphs {
                    builder.push_paragraph(page.page, paragraph);
                }
            }
            SourcePageContent::Scan(image) if include_scan_pages => {
                builder.close_open();
                builder.push_scan(page.page, *image);
            }
            SourcePageContent::Scan(_) => {}
        }
    }
    builder.close_open();
    builder.chunks
}

struct ChunkBuilder<'a> {
    glossary: &'a Glossary,
    /// `glossary.terms()[i]`의 글 토큰(원어 + 번역어)
    term_tokens: Vec<u64>,
    output_rate: PerMille,
    chunks: Vec<Chunk>,
    open: OpenChunk,
}

#[derive(Default)]
struct OpenChunk {
    items: Vec<ChunkItem>,
    text_tokens: u64,
    terms: BTreeSet<usize>,
}

impl<'a> ChunkBuilder<'a> {
    fn new(glossary: &'a Glossary, language: Language) -> Self {
        let term_tokens = glossary
            .terms()
            .iter()
            .map(|term| text_tokens(&term.source) + text_tokens(&term.target))
            .collect();
        let output_rate = match language {
            Language::Zh => OUTPUT_TOKENS_PER_INPUT_TOKEN_ZH,
            Language::En => OUTPUT_TOKENS_PER_INPUT_TOKEN_EN,
        };
        Self {
            glossary,
            term_tokens,
            output_rate,
            chunks: Vec::new(),
            open: OpenChunk::default(),
        }
    }

    fn glossary_tokens<'t>(&self, terms: impl IntoIterator<Item = &'t usize>) -> u64 {
        terms
            .into_iter()
            .map(|&index| self.term_tokens[index])
            .sum()
    }

    fn push_paragraph(&mut self, page: u32, paragraph: &SourceParagraph) {
        let tokens = text_tokens(&paragraph.text);
        let terms: BTreeSet<usize> = self.glossary.indices_in(&paragraph.text).collect();
        let capacity = CHUNK_INPUT_TOKEN_BUDGET
            .saturating_sub(CHUNK_OVERHEAD_TOKENS + self.glossary_tokens(&terms));
        if tokens > capacity {
            self.close_open();
            self.push_fragments(page, paragraph, capacity);
            return;
        }
        let merged_terms: BTreeSet<usize> = self.open.terms.union(&terms).copied().collect();
        let merged_input = CHUNK_OVERHEAD_TOKENS
            + self.glossary_tokens(&merged_terms)
            + self.open.text_tokens
            + tokens;
        if !self.open.items.is_empty() && merged_input > CHUNK_INPUT_TOKEN_BUDGET {
            self.close_open();
            self.open.terms = terms;
        } else {
            self.open.terms = merged_terms;
        }
        self.open.text_tokens += tokens;
        self.open.items.push(ChunkItem {
            page,
            number: paragraph.number,
            text: paragraph.text.clone(),
            fragment: None,
        });
    }

    /// 긴 문단을 조각으로 나눠 조각마다 묶음을 낸다. `capacity`는 문단 전체에 나오는 용어를 실어도
    /// 묶음이 상한 안인 글 토큰이다(조각에 나오는 용어는 그 부분이라 조각 묶음도 상한 안이다).
    fn push_fragments(&mut self, page: u32, paragraph: &SourceParagraph, capacity: u64) {
        let pieces = split_long_text(&paragraph.text, capacity);
        let count = saturate(pieces.len() as u64);
        for (index, piece) in pieces.into_iter().enumerate() {
            self.open.terms = self.glossary.indices_in(piece).collect();
            self.open.text_tokens = text_tokens(piece);
            self.open.items.push(ChunkItem {
                page,
                number: paragraph.number,
                text: piece.to_owned(),
                fragment: Some(Fragment {
                    index: saturate(index as u64),
                    count,
                }),
            });
            self.close_open();
        }
    }

    fn close_open(&mut self) {
        if self.open.items.is_empty() {
            return;
        }
        let open = std::mem::take(&mut self.open);
        let estimate = ChunkEstimate {
            input_tokens: saturate(
                CHUNK_OVERHEAD_TOKENS + self.glossary_tokens(&open.terms) + open.text_tokens,
            ),
            output_tokens: saturate(self.output_rate.of_ceil(open.text_tokens)),
        };
        let glossary = open
            .terms
            .iter()
            .map(|&index| self.glossary.terms()[index].clone())
            .collect();
        self.chunks.push(Chunk::Text(TextChunk {
            items: open.items,
            glossary,
            estimate,
        }));
    }

    fn push_scan(&mut self, page: u32, image: ScanImage) {
        let all_terms_tokens: u64 = self.term_tokens.iter().sum();
        let estimate = ChunkEstimate {
            input_tokens: saturate(CHUNK_OVERHEAD_TOKENS + image_tokens(image) + all_terms_tokens),
            output_tokens: saturate(SCAN_PAGE_OUTPUT_TOKENS),
        };
        self.chunks.push(Chunk::Scan(ScanChunk {
            page,
            image,
            glossary: self.glossary.terms().to_vec(),
            estimate,
        }));
    }
}

/// 글 토큰 = 한자 수 × `TOKENS_PER_HAN_CHAR` + 라틴 낱말 수 × `TOKENS_PER_LATIN_WORD` + 그 밖 글자
/// (공백 제외) 수 × `TOKENS_PER_OTHER_CHAR`, 올림(ADR 0002 §4)
fn text_tokens(text: &str) -> u64 {
    let mut count = TokenCount::default();
    text.chars().for_each(|c| count.push(c));
    count.tokens()
}

#[derive(Debug, Clone, Copy, Default)]
struct TokenCount {
    /// 천분율 토큰의 합
    milli_tokens: u64,
    in_latin_word: bool,
}

impl TokenCount {
    fn push(&mut self, c: char) {
        let latin = is_latin_letter(c);
        if latin && !self.in_latin_word {
            self.milli_tokens += TOKENS_PER_LATIN_WORD.0;
        } else if is_han(c) {
            self.milli_tokens += TOKENS_PER_HAN_CHAR.0;
        } else if !latin && !c.is_whitespace() {
            self.milli_tokens += TOKENS_PER_OTHER_CHAR.0;
        }
        self.in_latin_word = latin;
    }

    fn tokens(&self) -> u64 {
        self.milli_tokens.div_ceil(PER_MILLE_SCALE)
    }
}

fn image_tokens(image: ScanImage) -> u64 {
    u64::from(image.width_px.div_ceil(IMAGE_TOKEN_PATCH_PX))
        * u64::from(image.height_px.div_ceil(IMAGE_TOKEN_PATCH_PX))
}

/// 글을 글 토큰이 `capacity` 이하인 조각(앞뒤 공백을 지운, 비지 않은)으로 나눈다. 문장을 차례로
/// 채우고, 혼자 넘치는 문장은 글자로 나눈다. 조각마다 적어도 한 글자를 담아 늘 끝난다.
fn split_long_text(text: &str, capacity: u64) -> Vec<&str> {
    let mut units: Vec<Range<usize>> = Vec::new();
    for sentence in sentence_ranges(text) {
        if text_tokens(&text[sentence.clone()]) <= capacity {
            units.push(sentence);
        } else {
            units.extend(char_pieces(text, sentence, capacity));
        }
    }
    let mut pieces = Vec::new();
    let mut current: Option<Range<usize>> = None;
    for unit in units {
        current = match current {
            Some(open) if text_tokens(&text[open.start..unit.end]) <= capacity => {
                Some(open.start..unit.end)
            }
            Some(open) => {
                pieces.push(open);
                Some(unit)
            }
            None => Some(unit),
        };
    }
    pieces.extend(current);
    pieces
        .into_iter()
        .map(|range| text[range].trim())
        .filter(|piece| !piece.is_empty())
        .collect()
}

/// 문장 끝 글자(이어진 끝 글자·닫는 따옴표·괄호까지) 바로 뒤에서 나눈 바이트 범위
fn sentence_ranges(text: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((_, c)) = chars.next() {
        if !SENTENCE_TERMINATORS.contains(&c) {
            continue;
        }
        while let Some(&(_, next)) = chars.peek() {
            if SENTENCE_TERMINATORS.contains(&next) || SENTENCE_CLOSERS.contains(&next) {
                chars.next();
            } else {
                break;
            }
        }
        let end = chars.peek().map_or(text.len(), |&(index, _)| index);
        ranges.push(start..end);
        start = end;
    }
    if start < text.len() {
        ranges.push(start..text.len());
    }
    ranges
}

/// `range`를 글 토큰이 `capacity` 이하인 글자 묶음으로 나눈다(각 묶음에 적어도 한 글자).
fn char_pieces(text: &str, range: Range<usize>, capacity: u64) -> Vec<Range<usize>> {
    let mut pieces = Vec::new();
    let mut start = range.start;
    let mut count = TokenCount::default();
    for (offset, c) in text[range.clone()].char_indices() {
        let index = range.start + offset;
        let mut next = count;
        next.push(c);
        if next.tokens() > capacity && index > start {
            pieces.push(start..index);
            start = index;
            next = TokenCount::default();
            next.push(c);
        }
        count = next;
    }
    pieces.push(start..range.end);
    pieces
}

fn saturate(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}
