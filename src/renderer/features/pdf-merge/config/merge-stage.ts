import type { MergeStage } from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";

/** 병합 단계(`MergeProgress.stage`). 이 순서대로 진행한다. */
export const MERGE_STAGE = {
  READ_FILES: "readFiles",
  MERGE_PAGES: "mergePages",
  SAVE: "save"
} as const satisfies Record<string, MergeStage>;

export const MERGE_STAGE_ORDER: readonly MergeStage[] = [
  MERGE_STAGE.READ_FILES,
  MERGE_STAGE.MERGE_PAGES,
  MERGE_STAGE.SAVE
];

export const MERGE_STAGE_LABEL: Record<MergeStage, string> = {
  [MERGE_STAGE.READ_FILES]: "파일 읽기",
  [MERGE_STAGE.MERGE_PAGES]: "페이지 합치기",
  [MERGE_STAGE.SAVE]: "저장"
};

/** 진행률을 받기 전에 실패했을 때 보이는 단계 이름 */
export const MERGE_STAGE_NOT_STARTED_LABEL = "시작 전";

/** 진행 화면 단계 행의 세부. 개수를 세는 단계의 단위("6 / 6개 파일", "27 / 43쪽") */
export const MERGE_STAGE_COUNT_UNIT: Partial<Record<MergeStage, string>> = {
  [MERGE_STAGE.READ_FILES]: "개 파일",
  [MERGE_STAGE.MERGE_PAGES]: "쪽"
};

/** 저장 단계의 세부. 진행 화면은 전체 병합(늘 임시 파일로 쓴다)에만 뜬다. */
export const MERGE_SAVE_DETAIL = "임시 파일에 쓰기";

/** 진행 화면에서 단계가 지금 진행과 비교해 어디에 있는지 */
export const STAGE_STATE = {
  DONE: "done",
  ACTIVE: "active",
  PENDING: "pending"
} as const;

export type StageState = ValueOf<typeof STAGE_STATE>;
