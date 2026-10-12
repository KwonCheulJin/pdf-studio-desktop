import type { ValueOf } from "@/renderer/shared/types/common";

/** 고지 원문 읽기 상태 */
export const NOTICES_STATUS = {
  IDLE: "idle",
  LOADING: "loading",
  LOADED: "loaded",
  FAILED: "failed"
} as const;

export type NoticesStatus = ValueOf<typeof NOTICES_STATUS>;
