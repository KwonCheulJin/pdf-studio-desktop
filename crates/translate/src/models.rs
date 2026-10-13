//! 모델 표(계획서 Q7, ADR 0002 §5 "모델 표"). 모델 ID·출력 상한·요금·요금 기준일은 이 파일 한 곳에만
//! 둔다. 모델 ID는 앱 업데이트로만 바꾼다(원격으로 받지 않는다).
//!
//! 값은 ADR 0002 §15(공식 문서 `about-claude/models/overview`, 2026-10-13)에서 옮겼다. **확인하지
//! 못한 값**(출력 상한의 정확한 정수, 요금표 페이지의 요금)은 그 표시대로 두었다. Step 39가 모델 문서·
//! 요금표로 확인해 고치고, Step 48이 사용자 실측과 함께 기준일을 다시 본다.

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
}

/// 개요 표의 "128K". 128,000인지 131,072인지 확인하지 못해 작은 쪽을 둔다(넘는 `max_tokens`는
/// 400이지만 작게 두면 잘림 처리로 넘어갈 뿐이다). Step 39에서 모델 문서로 확인한다.
const MAX_OUTPUT_TOKENS_128K: u32 = 128_000;

/// 아래 요금을 개요 표에서 옮긴 날(ADR 0002 §15). 요금표 페이지로 확정하면 그날로 바꾼다(Step 39·48).
const PRICING_DATE: &str = "2026-10-13";

/// 1 USD = 1,000,000 micro-USD
const MICRO_USD_PER_USD: u64 = 1_000_000;

/// Sonnet 5.5: 개요 표 입력 $2·출력 $10 / 1M 토큰
const SONNET: ModelSpec = ModelSpec {
    api_id: "claude-sonnet-5-5",
    max_output_tokens: MAX_OUTPUT_TOKENS_128K,
    input_micro_usd_per_mtok: 2 * MICRO_USD_PER_USD,
    output_micro_usd_per_mtok: 10 * MICRO_USD_PER_USD,
    pricing_date: PRICING_DATE,
};

/// Haiku 5.5: 개요 표는 "From $0.10·$0.50"이라 등급 요금의 가장 낮은 값일 수 있다(확인하지 못함,
/// Step 39에서 요금표로 확정하고 Step 48에서 보정).
const HAIKU: ModelSpec = ModelSpec {
    api_id: "claude-haiku-5-5",
    max_output_tokens: MAX_OUTPUT_TOKENS_128K,
    input_micro_usd_per_mtok: MICRO_USD_PER_USD / 10,
    output_micro_usd_per_mtok: MICRO_USD_PER_USD / 2,
    pricing_date: PRICING_DATE,
};

impl TranslateModel {
    pub fn spec(self) -> &'static ModelSpec {
        match self {
            Self::Sonnet => &SONNET,
            Self::Haiku => &HAIKU,
        }
    }
}
