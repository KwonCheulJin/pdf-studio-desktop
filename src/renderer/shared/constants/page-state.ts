// 페이지 상태 관련 상수

import type { ValueOf } from "@/renderer/shared/types/common";

// 페이지 회전 각도 (0, 90, 180, 270)
export const PAGE_ROTATION = {
  DEG_0: 0,
  DEG_90: 90,
  DEG_180: 180,
  DEG_270: 270
} as const;

export type PageRotation = ValueOf<typeof PAGE_ROTATION>;

// 선택 타입 (파일 vs 페이지)
export const SELECTION_TYPE = {
  FILE: "file",
  PAGE: "page"
} as const;

export type SelectionType = ValueOf<typeof SELECTION_TYPE>;
