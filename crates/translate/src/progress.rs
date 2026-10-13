//! 번역 진행률(ADR 0002 §9). 비교 진행률(ADR 0001 §15)과 같은 규칙이다: 단계 %와 가중치로 전체 %를
//! 정수로 내려 계산하고, 화면에 보이는 값(단계, 단계 %, 전체 %)이 바뀔 때만 보고한다.
//!
//! `readDocument` 단계의 문단 추출·파일 해시는 pdf-core를 부르는 쪽(`src-tauri`)이 하므로 그쪽이
//! [`ProgressReporter::read_document_started`]로 0%를 알리고, 기록을 읽은 뒤의 100%부터는 실행기가 낸다.

use crate::usage::TokenUsage;

/// 단계 가중치(전체 % 중 몫, ADR 0002 §9 시작값). 실제 소요 시간으로 조정한다.
const READ_DOCUMENT_WEIGHT: u32 = 10;
const TRANSLATE_WEIGHT: u32 = 80;
const ARRANGE_WEIGHT: u32 = 10;
const FULL_PERCENT: u32 = 100;

const _: () = assert!(READ_DOCUMENT_WEIGHT + TRANSLATE_WEIGHT + ARRANGE_WEIGHT == FULL_PERCENT);

/// 번역 단계(계약 `TranslateStage`). 이 순서대로 진행한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranslateStage {
    /// 범위 쪽 문단 추출, 파일 해시, 기록 읽기. 단위는 범위 쪽
    ReadDocument,
    /// 묶음 보내기·검증·기록 쓰기. 단위는 묶음(전체 묶음 수)
    Translate,
    /// 쪽별 결과 조립. 단위는 범위 쪽
    Arrange,
}

impl TranslateStage {
    fn weight(self) -> u32 {
        match self {
            Self::ReadDocument => READ_DOCUMENT_WEIGHT,
            Self::Translate => TRANSLATE_WEIGHT,
            Self::Arrange => ARRANGE_WEIGHT,
        }
    }

    /// 이 단계 앞에서 이미 끝난 단계들의 가중치 합
    fn weight_before(self) -> u32 {
        match self {
            Self::ReadDocument => 0,
            Self::Translate => READ_DOCUMENT_WEIGHT,
            Self::Arrange => READ_DOCUMENT_WEIGHT + TRANSLATE_WEIGHT,
        }
    }
}

/// 진행 이벤트(계약 `TranslateProgress`)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslateProgress {
    /// 요청의 작업 ID 그대로
    pub job_id: String,
    pub stage: TranslateStage,
    pub done: u32,
    pub total: u32,
    /// `⌊done × 100 / total⌋`(`total`이 0이면 100)
    pub stage_percent: u32,
    /// `⌊(끝난 단계 가중치 합 × 100 + 단계 % × 지금 단계 가중치) / 100⌋`
    pub overall_percent: u32,
    /// 끝난 문단 수: 기록에 있던 것 + 이번에 번역·실패·거절로 정해진 것
    pub paragraphs_done: u32,
    /// 범위 안 글자층 문단 수 + 받아 적은 스캔 쪽 문단 수
    pub paragraph_count: u32,
    /// 이번 실행에서 받은 200 응답의 사용량 합
    pub usage: TokenUsage,
}

/// 이벤트에 싣는 문단 수
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ParagraphCounts {
    pub done: u32,
    pub count: u32,
}

/// 직전에 보고한 값과 단계·단계 %·전체 %가 모두 같으면 보고하지 않는다(단계 안에서 1% 단위).
pub struct ProgressReporter<F: FnMut(TranslateProgress)> {
    job_id: String,
    on_progress: F,
    last: Option<(TranslateStage, u32, u32)>,
}

impl<F: FnMut(TranslateProgress)> ProgressReporter<F> {
    pub fn new(job_id: &str, on_progress: F) -> Self {
        Self {
            job_id: job_id.to_owned(),
            on_progress,
            last: None,
        }
    }

    /// `readDocument` 0%(문단 수·사용량 0). 범위·원문 언어·키 검사를 통과한 뒤 문단 추출·파일 해시 전에
    /// 부른다(검사 오류는 이벤트 없이 끝난다). 이 단계 100%는 실행기가 기록을 읽은 뒤 낸다.
    pub fn read_document_started(&mut self, range_pages: u32) {
        self.report(
            TranslateStage::ReadDocument,
            0,
            range_pages,
            ParagraphCounts::default(),
            TokenUsage::default(),
        );
    }

    pub(crate) fn report(
        &mut self,
        stage: TranslateStage,
        done: u32,
        total: u32,
        paragraphs: ParagraphCounts,
        usage: TokenUsage,
    ) {
        let stage_percent = floored_percent(done, total);
        let overall_percent =
            (stage.weight_before() * FULL_PERCENT + stage_percent * stage.weight()) / FULL_PERCENT;
        let visible = (stage, stage_percent, overall_percent);
        if self.last == Some(visible) {
            return;
        }
        self.last = Some(visible);
        (self.on_progress)(TranslateProgress {
            job_id: self.job_id.clone(),
            stage,
            done,
            total,
            stage_percent,
            overall_percent,
            paragraphs_done: paragraphs.done,
            paragraph_count: paragraphs.count,
            usage,
        });
    }
}

/// `done / total`을 % 정수로 내린다. 단위가 없는 단계(`total == 0`)는 끝난 것으로 본다.
fn floored_percent(done: u32, total: u32) -> u32 {
    if total == 0 {
        return FULL_PERCENT;
    }
    let percent = u64::from(done.min(total)) * u64::from(FULL_PERCENT) / u64::from(total);
    // done ≤ total 이므로 percent ≤ 100 이라 변환은 실패하지 않는다.
    u32::try_from(percent).unwrap_or(FULL_PERCENT)
}

/// 경계 계약의 개수는 `u32`다. 넘는 값은 만들 수 없지만 넘으면 최댓값으로 둔다.
pub(crate) fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 묶음마다 알려도 보이는 값(단계 %·전체 %)이 바뀔 때만 보낸다: 묶음 1,000개면 0%~100% 101번이다.
    #[test]
    fn reports_only_when_a_visible_percent_changes() {
        let mut events = Vec::new();
        let mut reporter = ProgressReporter::new("job", |progress| events.push(progress));
        for done in 0..=1_000 {
            reporter.report(
                TranslateStage::Translate,
                done,
                1_000,
                ParagraphCounts::default(),
                TokenUsage::default(),
            );
        }

        let stage_percents: Vec<u32> = events.iter().map(|event| event.stage_percent).collect();
        assert_eq!(stage_percents, (0..=100).collect::<Vec<u32>>());
    }
}
