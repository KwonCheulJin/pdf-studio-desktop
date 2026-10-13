import type {
  CompareOptions,
  CompareProgress,
  CompareStage
} from "@/renderer/shared/api/bindings";
import {
  LINE_EXCLUSION_LABEL,
  LINE_EXCLUSION_ORDER
} from "../config/compare-options";
import {
  COMPARE_STAGE,
  COMPARE_STAGE_COUNT_UNIT,
  COMPARE_STAGE_DESCRIPTION,
  COMPARE_STAGE_ORDER,
  COMPARE_STAGE_TEXT,
  STAGE_STATE,
  type StageState
} from "../config/compare-stage";

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;
const CACHED_DETAIL = "cached" satisfies CompareProgress["detail"];
const DETAIL_SEPARATOR = " · ";
const LABEL_SEPARATOR = "·";

interface StageParams {
  stage: CompareStage;
  /** 마지막으로 받은 진행률(어느 단계든) */
  progress: CompareProgress | null;
}

/**
 * 지금 단계 앞은 끝남, 뒤는 대기다. 지금 단계도 100%를 받았으면 끝남이다.
 * 진행률을 받기 전(OCR 엔진을 처음 불러오는 동안 등)에는 모두 대기다.
 */
export function stageStateOf({ stage, progress }: StageParams): StageState {
  if (progress === null) return STAGE_STATE.PENDING;
  const stageIndex = COMPARE_STAGE_ORDER.indexOf(stage);
  const currentIndex = COMPARE_STAGE_ORDER.indexOf(progress.stage);
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

/** 글자 정리의 하는 일. 빼는 줄이 있으면 "공백·줄바꿈 정리 · 머리말·꼬리말 제외" */
function normalizeDescriptionOf(options: CompareOptions | null): string {
  const excluded = LINE_EXCLUSION_ORDER.filter(
    (exclusion) => options?.[exclusion] === true
  ).map((exclusion) => LINE_EXCLUSION_LABEL[exclusion]);
  const description = COMPARE_STAGE_DESCRIPTION[COMPARE_STAGE.NORMALIZE];
  return excluded.length === 0
    ? description
    : `${description}${DETAIL_SEPARATOR}${excluded.join(LABEL_SEPARATOR)} ${COMPARE_STAGE_TEXT.EXCLUDED_SUFFIX}`;
}

interface DescriptionParams {
  stage: CompareStage;
  options: CompareOptions | null;
}

function descriptionOf({ stage, options }: DescriptionParams): string {
  return stage === COMPARE_STAGE.NORMALIZE
    ? normalizeDescriptionOf(options)
    : COMPARE_STAGE_DESCRIPTION[stage];
}

interface ReportedDetailParams {
  reported: CompareProgress;
  options: CompareOptions | null;
}

/** 이 단계에서 받은 진행률로 만든 세부("12 / 19쪽 · 글자 위치 추출") */
function reportedDetailOf({ reported, options }: ReportedDetailParams): string {
  if (reported.detail === CACHED_DETAIL) return COMPARE_STAGE_TEXT.CACHED;
  if (reported.stage === COMPARE_STAGE.OCR && reported.total === 0) {
    return COMPARE_STAGE_TEXT.NO_SCANNED_PAGES;
  }
  const description = descriptionOf({ stage: reported.stage, options });
  const unit = COMPARE_STAGE_COUNT_UNIT[reported.stage];
  return unit === undefined
    ? description
    : `${reported.done} / ${reported.total}${unit}${DETAIL_SEPARATOR}${description}`;
}

interface StageDetailParams extends StageParams {
  /** 이 단계에서 마지막으로 받은 진행률. 아직 오지 않았으면 `undefined` */
  reported: CompareProgress | undefined;
  /** 보낸 옵션(글자 정리에서 빼는 줄) */
  options: CompareOptions | null;
}

/**
 * 작업 행의 세부(시안 9). 받은 진행률이 있으면 개수·캐시 여부를, 대기 단계는 하는 일만 보인다.
 * 화면 세부 문구는 단계 단위와 `done`·`total`로 만든다(ADR 0001 §15).
 */
export function stageDetailOf({
  stage,
  progress,
  reported,
  options
}: StageDetailParams): string {
  const state = stageStateOf({ stage, progress });
  if (state === STAGE_STATE.PENDING || reported === undefined) {
    return descriptionOf({ stage, options });
  }
  return reportedDetailOf({ reported, options });
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_WIDTH = 2;
const PAD_CHARACTER = "0";

/** 경과 시간 "0:04", "12:30" */
export function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(
    SECONDS_WIDTH,
    PAD_CHARACTER
  );
  return `${minutes}:${seconds}`;
}
