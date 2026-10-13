import type { CompareStage } from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";

/** 비교 단계(`CompareProgress.stage`). 이 순서대로 진행한다(ADR 0001 §15). */
export const COMPARE_STAGE = {
  EXTRACT_A: "extractA",
  EXTRACT_B: "extractB",
  OCR: "ocr",
  NORMALIZE: "normalize",
  DIFF: "diff",
  ALIGN_PAGES: "alignPages"
} as const satisfies Record<string, CompareStage>;

export const COMPARE_STAGE_ORDER: readonly CompareStage[] = [
  COMPARE_STAGE.EXTRACT_A,
  COMPARE_STAGE.EXTRACT_B,
  COMPARE_STAGE.OCR,
  COMPARE_STAGE.NORMALIZE,
  COMPARE_STAGE.DIFF,
  COMPARE_STAGE.ALIGN_PAGES
];

/** 진행 화면 작업 행 이름(계획서 §6.2 6번) */
export const COMPARE_STAGE_LABEL: Record<CompareStage, string> = {
  [COMPARE_STAGE.EXTRACT_A]: "A 문서 읽기",
  [COMPARE_STAGE.EXTRACT_B]: "B 문서 읽기",
  [COMPARE_STAGE.OCR]: "스캔 쪽 글자 읽기",
  [COMPARE_STAGE.NORMALIZE]: "글자 정리",
  [COMPARE_STAGE.DIFF]: "차이 찾기",
  [COMPARE_STAGE.ALIGN_PAGES]: "쪽 맞추기"
};

/** 작업 행 세부의 하는 일(개수가 있으면 그 뒤에 붙는다, 시안 9) */
export const COMPARE_STAGE_DESCRIPTION: Record<CompareStage, string> = {
  [COMPARE_STAGE.EXTRACT_A]: "글자 위치 추출",
  [COMPARE_STAGE.EXTRACT_B]: "글자 위치 추출",
  [COMPARE_STAGE.OCR]: "글자층이 없는 쪽만 읽어요",
  [COMPARE_STAGE.NORMALIZE]: "공백·줄바꿈 정리",
  [COMPARE_STAGE.DIFF]: "단어 단위 비교 후 바뀐 곳은 글자 단위",
  [COMPARE_STAGE.ALIGN_PAGES]: "A와 B의 쪽을 짝지어 나란히 놓기"
};

/**
 * 개수를 세는 단계의 단위("12 / 19쪽"). 차이 찾기(앵커 사이 구간)·쪽 맞추기(0%·100%만 온다)는
 * 개수가 사용자에게 뜻이 없어 하는 일만 보인다.
 */
export const COMPARE_STAGE_COUNT_UNIT: Partial<Record<CompareStage, string>> = {
  [COMPARE_STAGE.EXTRACT_A]: "쪽",
  [COMPARE_STAGE.EXTRACT_B]: "쪽",
  [COMPARE_STAGE.OCR]: "쪽",
  [COMPARE_STAGE.NORMALIZE]: "쪽"
};

export const COMPARE_STAGE_TEXT = {
  /** `detail: cached` — 앞선 실행에서 읽은 결과로 바로 끝났다. */
  CACHED: "앞서 읽은 결과 재사용",
  /** OCR 대상 쪽이 없어 바로 끝났다(`0 / 0`). */
  NO_SCANNED_PAGES: "스캔 쪽 없음",
  /** 글자 정리에서 빼는 줄이 있을 때 하는 일 뒤에 붙는다. */
  EXCLUDED_SUFFIX: "제외"
} as const;

/** 진행 화면에서 작업 행이 지금 진행과 비교해 어디에 있는지 */
export const STAGE_STATE = {
  DONE: "done",
  ACTIVE: "active",
  PENDING: "pending"
} as const;

export type StageState = ValueOf<typeof STAGE_STATE>;

export const COMPARE_PROGRESS_TEXT = {
  OVERALL: "전체 진행률",
  ELAPSED: "경과",
  STAGES: "작업별 진행",
  CANCEL: "취소",
  CANCELLING: "취소하는 중...",
  CANCEL_NOTE:
    "취소하면 다 읽지 못한 문서는 버려요. 옵션만 바꿔 다시 실행할 때는 읽은 결과를 재사용해요.",
  CANCEL_FAILED_TITLE: "비교를 취소하지 못했어요.",
  FAILED_TITLE: "비교하지 못했어요."
} as const;

/** 파일 이름이 들어가는 실패 알림 제목 */
export const compareRunFailureTitle = (fileName: string) =>
  `"${fileName}" 파일을 비교하지 못했어요.`;
