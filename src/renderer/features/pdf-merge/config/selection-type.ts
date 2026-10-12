import type { ValueOf } from "@/renderer/shared/types/common";

// 선택 타입 (파일 vs 페이지)
export const SELECTION_TYPE = {
  FILE: "file",
  PAGE: "page"
} as const;

export type SelectionType = ValueOf<typeof SELECTION_TYPE>;
