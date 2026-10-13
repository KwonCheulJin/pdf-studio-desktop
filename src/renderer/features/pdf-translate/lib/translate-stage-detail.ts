import type {
  TranslateProgress,
  TranslateStage
} from "@/renderer/shared/api/bindings";
import {
  STAGE_STATE,
  TRANSLATE_PROGRESS_TEXT,
  TRANSLATE_STAGE,
  TRANSLATE_STAGE_DESCRIPTION,
  TRANSLATE_STAGE_LABEL,
  TRANSLATE_STAGE_ORDER,
  translateProgressText,
  type StageState
} from "../config/translate-progress";

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

interface StageParams {
  stage: TranslateStage;
  /** 마지막으로 받은 진행률(어느 단계든) */
  progress: TranslateProgress | null;
}

/**
 * 지금 단계 앞은 끝남, 뒤는 대기다. 지금 단계도 100%를 받았으면 끝남이다.
 * 진행률을 받기 전에는 모두 대기다.
 */
export function stageStateOf({ stage, progress }: StageParams): StageState {
  if (progress === null) return STAGE_STATE.PENDING;
  const stageIndex = TRANSLATE_STAGE_ORDER.indexOf(stage);
  const currentIndex = TRANSLATE_STAGE_ORDER.indexOf(progress.stage);
  if (stageIndex < currentIndex) return STAGE_STATE.DONE;
  if (stageIndex > currentIndex) return STAGE_STATE.PENDING;
  return progress.stagePercent === PERCENT_MAX
    ? STAGE_STATE.DONE
    : STAGE_STATE.ACTIVE;
}

/** 끝난 단계는 100, 지금 단계는 보고된 값, 대기 단계는 0 */
export function stagePercentOf({ stage, progress }: StageParams): number {
  switch (stageStateOf({ stage, progress })) {
    case STAGE_STATE.DONE:
      return PERCENT_MAX;
    case STAGE_STATE.PENDING:
      return PERCENT_MIN;
    default:
      return progress?.stagePercent ?? PERCENT_MIN;
  }
}

/** 이 단계에서 받은 진행률로 만든 세부(시안 12, 계획서 §9.1.2 진행 단계 표) */
function reportedDetailOf(reported: TranslateProgress): string {
  const description = TRANSLATE_STAGE_DESCRIPTION[reported.stage];
  const count = translateProgressText.stageCount(reported);
  switch (reported.stage) {
    case TRANSLATE_STAGE.READ_DOCUMENT:
      // 문단 수는 기록을 읽은 뒤(100%)부터 실린다(ADR 0002 §9). 그 전에는 하는 일을 붙인다.
      return translateProgressText.joinDetail([
        count,
        reported.paragraphCount > 0
          ? translateProgressText.paragraphCount(reported.paragraphCount)
          : description
      ]);
    case TRANSLATE_STAGE.TRANSLATE:
      return translateProgressText.joinDetail([
        count,
        translateProgressText.paragraphProgress({
          done: reported.paragraphsDone,
          total: reported.paragraphCount
        })
      ]);
    default:
      // 대역 배치는 금방 끝나 개수가 사용자에게 뜻이 없어 하는 일만 보인다.
      return description;
  }
}

interface StageDetailParams extends StageParams {
  /** 이 단계에서 마지막으로 받은 진행률. 아직 오지 않았으면 `undefined` */
  reported: TranslateProgress | undefined;
}

/** 작업 행의 세부. 받은 진행률이 있으면 개수를, 대기 단계는 하는 일만 보인다. */
export function stageDetailOf({
  stage,
  progress,
  reported
}: StageDetailParams): string {
  const state = stageStateOf({ stage, progress });
  if (state === STAGE_STATE.PENDING || reported === undefined) {
    return TRANSLATE_STAGE_DESCRIPTION[stage];
  }
  return reportedDetailOf(reported);
}

/** 실패 화면의 멈춘 곳: 마지막으로 받은 단계와 개수(`번역 · 7 / 14묶음`), 받기 전이면 "시작 전" */
export function stoppedAtOf(progress: TranslateProgress | null): string {
  if (progress === null) return TRANSLATE_PROGRESS_TEXT.NOT_STARTED;
  return translateProgressText.joinDetail([
    TRANSLATE_STAGE_LABEL[progress.stage],
    translateProgressText.stageCount(progress)
  ]);
}
