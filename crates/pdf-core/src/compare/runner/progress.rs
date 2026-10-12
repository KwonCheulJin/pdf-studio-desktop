//! 비교 진행률(계획서 §6.2 6번, ADR 0001 §15). 단계 %와 가중치로 전체 %를 정수로 내려 계산하고,
//! 화면에 보이는 값(단계, 단계 %, 전체 %)이 바뀔 때만 보고한다. 병합 진행률(`merge/progress.rs`)과
//! 같은 방식이다.

/// 단계 가중치(전체 % 중 몫). 계획서 §6.2 6번의 시작값이다. 측정값은 ADR 0001 §15에 두고, 실제
/// 소요 시간으로 조정한다.
const EXTRACT_A_WEIGHT: u8 = 20;
const EXTRACT_B_WEIGHT: u8 = 20;
const OCR_WEIGHT: u8 = 30;
const NORMALIZE_WEIGHT: u8 = 5;
const DIFF_WEIGHT: u8 = 15;
const ALIGN_PAGES_WEIGHT: u8 = 10;
const FULL_PERCENT: u8 = 100;

const _: () = assert!(
    EXTRACT_A_WEIGHT
        + EXTRACT_B_WEIGHT
        + OCR_WEIGHT
        + NORMALIZE_WEIGHT
        + DIFF_WEIGHT
        + ALIGN_PAGES_WEIGHT
        == FULL_PERCENT
);

/// 비교 단계. 이 순서대로 진행하고, 앞 단계가 끝나야 다음 단계가 시작한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CompareStage {
    /// A 문서 텍스트 레이어 추출. 단위는 A의 쪽(문서 전체)
    ExtractA,
    /// B 문서 텍스트 레이어 추출. 단위는 B의 쪽(문서 전체)
    ExtractB,
    /// 스캔 쪽 OCR. 단위는 두 문서 비교 범위 안의 OCR 대상 쪽(A·B 합)
    Ocr,
    /// 쪽 범위 선택·줄 제외·토큰화. 단위는 두 문서 비교 범위의 쪽(A·B 합)
    Normalize,
    /// 토큰 diff. 단위는 앵커 사이 구간
    Diff,
    /// 쪽 짝짓기. 단위는 두 문서 비교 범위의 쪽(A·B 합, 쪽마다 한 행에 한 번 놓인다)
    AlignPages,
}

impl CompareStage {
    const ORDER: [Self; 6] = [
        Self::ExtractA,
        Self::ExtractB,
        Self::Ocr,
        Self::Normalize,
        Self::Diff,
        Self::AlignPages,
    ];

    fn weight(self) -> u8 {
        match self {
            Self::ExtractA => EXTRACT_A_WEIGHT,
            Self::ExtractB => EXTRACT_B_WEIGHT,
            Self::Ocr => OCR_WEIGHT,
            Self::Normalize => NORMALIZE_WEIGHT,
            Self::Diff => DIFF_WEIGHT,
            Self::AlignPages => ALIGN_PAGES_WEIGHT,
        }
    }

    /// 이 단계 앞에서 이미 끝난 단계들의 가중치 합
    fn weight_before(self) -> u8 {
        Self::ORDER
            .into_iter()
            .take_while(|stage| *stage != self)
            .map(Self::weight)
            .sum()
    }
}

/// `done`·`total`로 알 수 없는 덧붙임 정보
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgressDetail {
    /// 이 단계의 결과를 앞선 실행의 캐시에서 가져와 바로 끝났다(추출 캐시 적중, 또는 OCR 대상 쪽이
    /// 모두 추출 캐시·OCR 캐시에 있음).
    Cached,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompareProgress {
    /// 요청의 작업 ID 그대로
    pub job_id: String,
    pub stage: CompareStage,
    pub done: u32,
    pub total: u32,
    /// 이 단계의 진행 %(정수 내림). 단위가 없는 단계(`total == 0`)는 100이다.
    pub stage_percent: u8,
    /// `Σ(단계 % × 가중치) / 100`(정수 내림, 끝난 단계는 100%). 100은 마지막 단계가 끝났을 때만 나온다.
    pub overall_percent: u8,
    pub detail: Option<ProgressDetail>,
}

/// `done / total`을 % 정수로 내린다. 단위가 없는 단계(`total == 0`)는 끝난 것으로 본다.
fn floored_percent(done: usize, total: usize) -> u8 {
    if total == 0 {
        return FULL_PERCENT;
    }
    let percent = done.min(total) as u128 * u128::from(FULL_PERCENT) / total as u128;
    // done ≤ total 이므로 percent ≤ 100 이라 변환은 실패하지 않는다.
    u8::try_from(percent).unwrap_or(FULL_PERCENT)
}

fn overall_percent(stage: CompareStage, stage_percent: u8) -> u8 {
    let weighted = u16::from(stage.weight_before()) * u16::from(FULL_PERCENT)
        + u16::from(stage_percent) * u16::from(stage.weight());
    // 가중치 합이 100이라 몫은 100을 넘지 않는다.
    u8::try_from(weighted / u16::from(FULL_PERCENT)).unwrap_or(FULL_PERCENT)
}

/// 경계 계약의 개수는 `u32`다. 넘는 값(쪽·구간이 40억 개)은 만들 수 없지만 넘으면 최댓값으로 둔다.
fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// 직전에 보고한 값과 단계·단계 %·전체 %가 모두 같으면 보고하지 않는다(단계 안에서 1% 단위).
pub(super) struct ProgressReporter<'a, F: FnMut(CompareProgress)> {
    job_id: &'a str,
    on_progress: F,
    last: Option<(CompareStage, u8, u8)>,
}

impl<'a, F: FnMut(CompareProgress)> ProgressReporter<'a, F> {
    pub(super) fn new(job_id: &'a str, on_progress: F) -> Self {
        Self {
            job_id,
            on_progress,
            last: None,
        }
    }

    pub(super) fn report(&mut self, stage: CompareStage, done: usize, total: usize) {
        self.send(stage, done, total, None);
    }

    /// 캐시로 바로 끝난 단계: 100% 하나만 보낸다.
    pub(super) fn report_cached(&mut self, stage: CompareStage, total: usize) {
        self.send(stage, total, total, Some(ProgressDetail::Cached));
    }

    fn send(
        &mut self,
        stage: CompareStage,
        done: usize,
        total: usize,
        detail: Option<ProgressDetail>,
    ) {
        let stage_percent = floored_percent(done, total);
        let overall_percent = overall_percent(stage, stage_percent);
        let visible = (stage, stage_percent, overall_percent);
        if self.last == Some(visible) {
            return;
        }
        self.last = Some(visible);
        (self.on_progress)(CompareProgress {
            job_id: self.job_id.to_owned(),
            stage,
            done: count(done),
            total: count(total),
            stage_percent,
            overall_percent,
            detail,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reported(steps: &[(CompareStage, usize, usize)]) -> Vec<CompareProgress> {
        let mut events = Vec::new();
        let mut reporter = ProgressReporter::new("job", |progress| events.push(progress));
        for &(stage, done, total) in steps {
            reporter.report(stage, done, total);
        }
        events
    }

    fn percents(events: &[CompareProgress]) -> Vec<(u8, u8)> {
        events
            .iter()
            .map(|progress| (progress.stage_percent, progress.overall_percent))
            .collect()
    }

    /// 전체 % = Σ(단계 % × 가중치) / 100을 정수로 내린다. 반올림하면 100이 되는 지점에서도 마지막
    /// 단계가 끝나기 전에는 100이 나오지 않는다.
    #[test]
    fn overall_percent_is_floored_weighted_sum_of_stage_percents() {
        let events = reported(&[
            // A 추출 1/3: 단계 33, 전체 33 × 20 / 100 = 6.6 → 6
            (CompareStage::ExtractA, 1, 3),
            // diff 1/15: 단계 6, 전체 (75 × 100 + 6 × 15) / 100 = 75.9 → 75. 단계 %를 거치지 않고
            // done × 가중치 / total로 세면 76이 된다.
            (CompareStage::Diff, 1, 15),
            // diff 199/200: 단계 99, 전체 (75 × 100 + 99 × 15) / 100 = 89.85 → 89
            (CompareStage::Diff, 199, 200),
            // 쪽 짝짓기 999/1000: 단계 99, 전체 (90 × 100 + 99 × 10) / 100 = 99.9 → 99
            (CompareStage::AlignPages, 999, 1_000),
            (CompareStage::AlignPages, 1_000, 1_000),
        ]);

        assert_eq!(
            percents(&events),
            [(33, 6), (6, 75), (99, 89), (99, 99), (100, 100)]
        );
    }

    /// 쪽마다 알려도 보이는 값(단계 %·전체 %)이 바뀔 때만 보낸다: 1,000쪽이면 0%~100% 101번이다.
    #[test]
    fn reports_only_when_a_visible_percent_changes() {
        let steps: Vec<_> = (0..=1_000)
            .map(|done| (CompareStage::ExtractB, done, 1_000))
            .collect();

        let events = reported(&steps);

        let stage_percents: Vec<u8> = events.iter().map(|event| event.stage_percent).collect();
        assert_eq!(stage_percents, (0..=100).collect::<Vec<u8>>());
    }
}
