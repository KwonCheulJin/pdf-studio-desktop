import type {
  MergeProgress,
  MergeSource,
  MergeStage
} from "@/renderer/shared/api/bindings";
import {
  MERGE_SAVE_DETAIL,
  MERGE_STAGE,
  MERGE_STAGE_COUNT_UNIT,
  MERGE_STAGE_ORDER,
  STAGE_STATE,
  type StageState
} from "../config/merge-stage";

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

interface StageParams {
  stage: MergeStage;
  progress: MergeProgress | null;
}

/** 진행률을 받기 전에는 모든 단계가 대기다. */
export function stageStateOf({ stage, progress }: StageParams): StageState {
  if (progress === null) return STAGE_STATE.PENDING;
  const stageIndex = MERGE_STAGE_ORDER.indexOf(stage);
  const currentIndex = MERGE_STAGE_ORDER.indexOf(progress.stage);
  if (stageIndex < currentIndex) return STAGE_STATE.DONE;
  if (stageIndex > currentIndex) return STAGE_STATE.PENDING;
  return STAGE_STATE.ACTIVE;
}

/** 지난 단계는 100, 지금 단계는 보고된 값, 아직 오지 않은 단계는 0 */
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

interface FormatStageCountParams {
  stage: MergeStage;
  done: number;
  total: number;
}

/** "6 / 6개 파일", "27 / 43쪽". 개수를 세지 않는 단계(저장)는 `null` */
export function formatStageCount({
  stage,
  done,
  total
}: FormatStageCountParams): string | null {
  const unit = MERGE_STAGE_COUNT_UNIT[stage];
  return unit === undefined ? null : `${done} / ${total}${unit}`;
}

interface StageTotalParams {
  stage: MergeStage;
  sources: MergeSource[];
}

/** 소스로 센 단계 전체 개수: 파일 읽기는 파일 수, 페이지 합치기는 쪽 수 */
function stageTotalOf({ stage, sources }: StageTotalParams): number {
  return stage === MERGE_STAGE.READ_FILES
    ? sources.length
    : sources.reduce((sum, source) => sum + source.pages.length, 0);
}

interface StageDetailParams extends StageParams {
  /** 이번 병합에 보낸 소스. 지금 단계가 아닌 단계의 전체 개수를 센다. */
  sources: MergeSource[];
}

/**
 * 진행 화면 단계 행의 세부(시안 7). 지금 단계는 보고된 개수,
 * 지난 단계는 다 셌고, 대기 단계는 0부터다. 저장은 고정 문구.
 */
export function stageDetailOf({
  stage,
  progress,
  sources
}: StageDetailParams): string {
  const state = stageStateOf({ stage, progress });
  if (state === STAGE_STATE.ACTIVE && progress !== null) {
    return (
      formatStageCount({ stage, done: progress.done, total: progress.total }) ??
      MERGE_SAVE_DETAIL
    );
  }
  const total = stageTotalOf({ stage, sources });
  const done = state === STAGE_STATE.DONE ? total : 0;
  return formatStageCount({ stage, done, total }) ?? MERGE_SAVE_DETAIL;
}
