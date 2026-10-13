//! 모델 표(계획서 Q7, ADR 0002 §5 "모델 표"). 모델 ID·출력 상한·요금·요금 기준일은 이 파일 한 곳에만
//! 둔다. 모델 ID는 앱 업데이트로만 바꾼다(원격으로 받지 않는다).
//!
//! 값은 공식 문서(`platform.claude.com/docs/en/…`, 2026-10-13 확인, ADR 0002 §15)에서 옮겼다: 모델 쪽
//! `models/sonnet-5-5/overview`·`models/haiku-5-5/overview`, 요금 `about-claude/pricing`, thinking
//! `build-with-claude/thinking`. Step 48이 사용자 실측과 함께 기준일을 다시 본다.

/// 번역 모델(계약 `TranslateModel`, ADR 0002 §10). 화면 이름·설명은 프론트 설정에 둔다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranslateModel {
    Sonnet,
    Haiku,
}

/// 모델 하나의 API 값과 요금
#[derive(Debug, PartialEq, Eq)]
pub struct ModelSpec {
    /// Messages API `model` 값
    pub api_id: &'static str,
    /// 응답 하나의 출력 토큰 상한(`max_tokens`의 위 끝)
    pub max_output_tokens: u32,
    /// 입력 1M 토큰당 요금(micro-USD = 0.000001 USD)
    pub input_micro_usd_per_mtok: u64,
    /// 출력 1M 토큰당 요금(micro-USD)
    pub output_micro_usd_per_mtok: u64,
    /// 요금을 옮긴 날 `YYYY-MM-DD`(계약 `TranslationPlan.pricing_date`)
    pub pricing_date: &'static str,
    /// 요청의 `thinking`(ADR 0002 §5). 두 모델의 요청 차이는 `model`과 이것뿐이다.
    pub thinking: Thinking,
}

/// 요청 `thinking.type`. 생략하면 두 모델 모두 adaptive thinking이 켜져 생각 토큰이 출력 요금·
/// `max_tokens`에 든다. 번역에는 생각이 필요 없고 예상치(ADR 0002 §4)가 생각을 세지 않으므로 끈다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Thinking {
    /// 앞선 생각을 끈다. Sonnet 5.5의 가장 낮은 설정이고(`disabled`는 400), 도구가 없으면 응답은 글뿐이다.
    BetweenTools,
    /// 생각을 끈다(Haiku 5.5, `high` 이하 effort에서 받는다).
    Disabled,
}

impl Thinking {
    /// `thinking.type` 값
    pub(crate) fn api_type(self) -> &'static str {
        match self {
            Self::BetweenTools => "between_tools",
            Self::Disabled => "disabled",
        }
    }
}

/// 모델 문서·`build-with-claude/context-windows`의 "128K"/"128k output tokens". 문서는 정확한 정수를
/// 적지 않는다(2026-10-13 확인. 정수는 키가 있어야 하는 Models API `max_tokens`에만 있다). 128,000과
/// 131,072 가운데 작은 쪽을 둔다: 넘는 `max_tokens`는 400이고, 작게 두어도 잘림 처리로 넘어갈 뿐이다.
/// 묶음의 `max_tokens`는 1만 남짓이라(ADR 0002 §4) 이 차이에 닿지 않는다.
const MAX_OUTPUT_TOKENS_128K: u32 = 128_000;

/// 아래 요금을 요금표(`about-claude/pricing`)와 모델 문서에서 확인한 날(ADR 0002 §15)
const PRICING_DATE: &str = "2026-10-13";

/// 1 USD = 1,000,000 micro-USD
const MICRO_USD_PER_USD: u64 = 1_000_000;

/// Sonnet 5.5: 요금표 입력 $2·출력 $10 / 1M 토큰(문맥 1M 전체가 같은 요금)
const SONNET: ModelSpec = ModelSpec {
    api_id: "claude-sonnet-5-5",
    max_output_tokens: MAX_OUTPUT_TOKENS_128K,
    input_micro_usd_per_mtok: 2 * MICRO_USD_PER_USD,
    output_micro_usd_per_mtok: 10 * MICRO_USD_PER_USD,
    pricing_date: PRICING_DATE,
    thinking: Thinking::BetweenTools,
};

/// Haiku 5.5: 요금표 입력 $0.10·출력 $0.50 / 1M 토큰은 **프롬프트(입력) 100,000토큰 이하** 요청의
/// 요금이다(넘으면 $0.50·$2.50, 개요 표의 "From"이 이 뜻). 텍스트 묶음 입력은 상한 2,500토큰이고,
/// 스캔 묶음은 그림 약 2,240토큰 + 용어집 전체라 용어집 상한(`MAX_GLOSSARY_TERMS` 500개·글자 수
/// 상한, Step 41)이 요청 입력을 100,000토큰 아래로 지켜야 이 요금이 맞다.
const HAIKU: ModelSpec = ModelSpec {
    api_id: "claude-haiku-5-5",
    max_output_tokens: MAX_OUTPUT_TOKENS_128K,
    input_micro_usd_per_mtok: MICRO_USD_PER_USD / 10,
    output_micro_usd_per_mtok: MICRO_USD_PER_USD / 2,
    pricing_date: PRICING_DATE,
    thinking: Thinking::Disabled,
};

impl TranslateModel {
    /// 앱이 쓰는 모든 모델. 키 확인(ADR 0002 §10 `verify_api_key`)이 이 모델들이 목록에 있는지 본다.
    pub(crate) const ALL: [Self; 2] = [Self::Sonnet, Self::Haiku];

    pub fn spec(self) -> &'static ModelSpec {
        match self {
            Self::Sonnet => &SONNET,
            Self::Haiku => &HAIKU,
        }
    }
}
