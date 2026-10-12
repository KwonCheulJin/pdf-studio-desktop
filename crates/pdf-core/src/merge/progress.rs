//! 병합 진행률. 단계별 %와 가중치를 합친 전체 %를 정수로 내려 계산하고,
//! 화면에 보이는 값이 바뀔 때만 보고한다.

/// 단계 가중치(전체 % 중 몫). 실제 소요 시간을 측정해 조정한다.
const READ_FILES_WEIGHT: u8 = 20;
const MERGE_PAGES_WEIGHT: u8 = 70;
const SAVE_WEIGHT: u8 = 10;
const FULL_PERCENT: u8 = 100;

const _: () = assert!(READ_FILES_WEIGHT + MERGE_PAGES_WEIGHT + SAVE_WEIGHT == FULL_PERCENT);

/// 병합 단계. 이 순서대로 진행한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeStage {
    /// 소스 파일 열기·검증. 단위는 파일
    ReadFiles,
    /// 새 문서에 페이지 넣기·회전 적용. 단위는 출력 페이지
    MergePages,
    /// 출력 파일 저장. 단위는 저장 한 번
    Save,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MergeProgress {
    pub stage: MergeStage,
    pub done: usize,
    pub total: usize,
    /// 이 단계의 진행 % (정수 내림)
    pub stage_percent: u8,
    /// 가중치를 반영한 전체 % (정수 내림). 100은 마지막 단계가 끝났을 때만 나온다.
    pub overall_percent: u8,
}

impl MergeStage {
    fn weight(self) -> u8 {
        match self {
            Self::ReadFiles => READ_FILES_WEIGHT,
            Self::MergePages => MERGE_PAGES_WEIGHT,
            Self::Save => SAVE_WEIGHT,
        }
    }

    /// 이 단계 앞에서 이미 끝난 단계들의 가중치 합
    fn weight_before(self) -> u8 {
        match self {
            Self::ReadFiles => 0,
            Self::MergePages => READ_FILES_WEIGHT,
            Self::Save => READ_FILES_WEIGHT + MERGE_PAGES_WEIGHT,
        }
    }
}

/// `done / total`을 `scale` 기준 정수로 내린다. 단위가 없는 단계(`total == 0`)는 끝난 것으로 본다.
fn floored_share(done: usize, total: usize, scale: u8) -> u8 {
    if total == 0 {
        return scale;
    }
    let share = done.min(total) * usize::from(scale) / total;
    // done ≤ total 이므로 share ≤ scale 이라 변환은 실패하지 않는다.
    u8::try_from(share).unwrap_or(scale)
}

pub(crate) fn progress_of(stage: MergeStage, done: usize, total: usize) -> MergeProgress {
    MergeProgress {
        stage,
        done,
        total,
        stage_percent: floored_share(done, total, FULL_PERCENT),
        overall_percent: stage.weight_before() + floored_share(done, total, stage.weight()),
    }
}

/// 직전에 보고한 값과 단계·단계 %·전체 % 가 모두 같으면 보고하지 않는다.
pub(crate) struct ProgressReporter<F: FnMut(MergeProgress)> {
    on_progress: F,
    last: Option<MergeProgress>,
}

impl<F: FnMut(MergeProgress)> ProgressReporter<F> {
    pub(crate) fn new(on_progress: F) -> Self {
        Self {
            on_progress,
            last: None,
        }
    }

    pub(crate) fn report(&mut self, stage: MergeStage, done: usize, total: usize) {
        let progress = progress_of(stage, done, total);
        if self
            .last
            .is_some_and(|last| looks_the_same(&last, &progress))
        {
            return;
        }
        self.last = Some(progress);
        (self.on_progress)(progress);
    }
}

fn looks_the_same(left: &MergeProgress, right: &MergeProgress) -> bool {
    left.stage == right.stage
        && left.stage_percent == right.stage_percent
        && left.overall_percent == right.overall_percent
}

#[cfg(test)]
mod tests {
    use super::*;

    fn visible(progress: &MergeProgress) -> (u8, u8) {
        (progress.stage_percent, progress.overall_percent)
    }

    #[test]
    fn stage_and_overall_percent_are_floored() {
        // 반올림하면 100(단계) · 90/20(전체)이 되는 지점들이다.
        assert_eq!(
            visible(&progress_of(MergeStage::MergePages, 999, 1_000)),
            (99, 89)
        );
        assert_eq!(
            visible(&progress_of(MergeStage::ReadFiles, 199, 200)),
            (99, 19)
        );
    }

    fn reported(steps: &[(MergeStage, usize, usize)]) -> Vec<MergeProgress> {
        let mut events = Vec::new();
        let mut reporter = ProgressReporter::new(|progress| events.push(progress));
        for (stage, done, total) in steps {
            reporter.report(*stage, *done, *total);
        }
        events
    }

    #[test]
    fn reports_only_when_a_visible_percent_changes() {
        // 파일 200개: 단계 %는 짝수 번째마다, 전체 %는 10의 배수마다 오른다.
        // 10의 배수는 모두 짝수이므로 보고는 0, 2, 4, ..., 200 에서만 일어난다.
        let steps: Vec<_> = (0..=200)
            .map(|done| (MergeStage::ReadFiles, done, 200))
            .collect();

        let done_values: Vec<usize> = reported(&steps)
            .iter()
            .map(|progress| progress.done)
            .collect();

        assert_eq!(done_values, (0..=200).step_by(2).collect::<Vec<_>>());
    }

    #[test]
    fn overall_change_alone_is_reported() {
        // 150쪽 중 6→7쪽: 단계 %는 4.0→4.67 로 4 그대로, 전체 %는 20+2.8→20+3.27 로 22→23
        let events = reported(&[
            (MergeStage::MergePages, 6, 150),
            (MergeStage::MergePages, 7, 150),
        ]);

        let percents: Vec<(u8, u8)> = events.iter().map(visible).collect();
        assert_eq!(percents, vec![(4, 22), (4, 23)]);
    }
}
