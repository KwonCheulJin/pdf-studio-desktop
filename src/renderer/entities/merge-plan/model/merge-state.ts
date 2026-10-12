import type { ValueOf } from "@/renderer/shared/types/common";

// Merge 상태 타입

export const MERGE_STATUS = {
  IDLE: "idle",
  MERGING: "merging",
  COMPLETE: "complete",
  ERROR: "error"
} as const;

export type MergeStatus = ValueOf<typeof MERGE_STATUS>;
export const MERGE_VIEW = {
  WORKSPACE: "workspace",
  PREVIEW: "preview"
} as const;

export type MergeView = ValueOf<typeof MERGE_VIEW>;
