import type { ValueOf } from "@/renderer/shared/types/common";

// 페이지 회전 각도 (0, 90, 180, 270)
export const PAGE_ROTATION = {
  DEG_0: 0,
  DEG_90: 90,
  DEG_180: 180,
  DEG_270: 270
} as const;

export type PageRotation = ValueOf<typeof PAGE_ROTATION>;
