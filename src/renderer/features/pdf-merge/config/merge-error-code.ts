import type { ErrorCode } from "@/renderer/shared/api/bindings";

/** 병합 흐름이 따로 처리하는 오류 코드 */
export const MERGE_ERROR_CODE = {
  /** 취소는 오류로 보이지 않는다. */
  CANCELLED: "CANCELLED",
  /** 병합할 페이지가 없을 때 보일 문구의 코드 */
  EMPTY_REQUEST: "EMPTY_REQUEST"
} as const satisfies Record<string, ErrorCode>;
