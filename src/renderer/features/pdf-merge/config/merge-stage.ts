import type { MergeStage } from "@/renderer/shared/api/bindings";

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
