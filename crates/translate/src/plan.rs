//! 실행 전 계획(ADR 0002 §4 "계획", §10 `TranslationPlan`). 네트워크를 쓰지 않는다. 묶음은 실행기와 같은
//! [`build_chunks`]로 범위 전체를 만들고, 예상 입력·출력·요금은 **보낼 것만** 센다: 같은 옵션의 기록에 있는
//! 문단·스캔 쪽은 빼고, 일부만 남은 텍스트 묶음은 남은 항목만([`estimate_text_items`]). 이어하기 가능 여부와
//! 문단 수는 실행기가 시작할 때 알리는 값과 같다.

use crate::chunk::{build_chunks, estimate_text_items, estimated_cost_micro_usd};
use crate::glossary::Glossary;
use crate::language::Language;
use crate::models::TranslateModel;
use crate::progress::count;
use crate::record::TranslationRecord;
use crate::runner::{Pending, paragraph_keys, pending};
use crate::source::SourcePage;

/// 계획에 쓰는 입력
pub struct PlanInput<'a> {
    /// 범위 안 쪽(쪽 번호 오름차순)
    pub pages: &'a [SourcePage],
    pub glossary: &'a Glossary,
    /// 정해진 원문 언어. 자동 감지로 정하지 못했으면 `None`이다(예상치 0, 화면이 실행을 막는다).
    pub language: Option<Language>,
    pub model: TranslateModel,
    pub include_scan_pages: bool,
    /// 같은 옵션의 이어하기 기록. 있으면 그 기록에 있는 것을 보낼 것에서 뺀다.
    pub record: Option<&'a TranslationRecord>,
}

/// 계획(계약 `TranslationPlan`의 묶음·예상·이어하기)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslationPlan {
    /// 범위 안 글자층 문단 수 + 기록에 있는 스캔 쪽의 받아 적은 문단 수
    pub paragraph_count: u32,
    /// 범위 전체 묶음 수(진행 `translate` 단계의 `total`)
    pub chunk_count: u32,
    pub estimated_input_tokens: u32,
    pub estimated_output_tokens: u32,
    /// micro-USD(0.000001 USD)
    pub estimated_cost_micro_usd: u32,
    /// 기록에 끝난 문단이 있으면 그 수
    pub resumable: Option<ResumeState>,
}

/// 이어하기로 이미 끝난 문단(계약 `ResumeState`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResumeState {
    pub translated_paragraphs: u32,
    pub paragraph_count: u32,
}

pub fn plan_translation(input: PlanInput<'_>) -> TranslationPlan {
    let record = input.record.map(|record| &record.0);
    // 묶음 경계는 입력 예상으로만 정하므로 원문 언어와 상관없다(언어는 출력 예상 비율만 바꾼다).
    let chunks = build_chunks(
        input.pages,
        input.glossary,
        input.language.unwrap_or(Language::Zh),
        input.include_scan_pages,
    );
    let (keys, counts) = paragraph_keys(input.pages, input.include_scan_pages, record);
    let mut input_tokens = 0_u64;
    let mut output_tokens = 0_u64;
    let mut cost = 0;
    if let Some(language) = input.language {
        for chunk in &chunks {
            let estimate = match pending(chunk, &keys, record) {
                Some(Pending::Text(chunk)) => {
                    estimate_text_items(&chunk.items, &chunk.glossary, language)
                }
                Some(Pending::Scan(chunk)) => chunk.estimate,
                None => continue,
            };
            input_tokens += u64::from(estimate.input_tokens);
            output_tokens += u64::from(estimate.output_tokens);
        }
        cost = estimated_cost_micro_usd(input_tokens, output_tokens, input.model);
    }
    TranslationPlan {
        paragraph_count: counts.count,
        chunk_count: count(chunks.len()),
        estimated_input_tokens: saturate(input_tokens),
        estimated_output_tokens: saturate(output_tokens),
        estimated_cost_micro_usd: cost,
        resumable: (counts.done > 0).then_some(ResumeState {
            translated_paragraphs: counts.done,
            paragraph_count: counts.count,
        }),
    }
}

fn saturate(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}
