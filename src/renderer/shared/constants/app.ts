import type { ValueOf } from "@/renderer/shared/types/common";

export const APP_STATUS = {
  READY: "준비",
  PROCESSING: "처리 중...",
  COMPLETE: "완료",
  ERROR: "오류"
} as const;

export type AppStatus = ValueOf<typeof APP_STATUS>;

export const FILE_EXTENSIONS = {
  PDF: ".pdf",
  TIFF: ".tiff",
  TIF: ".tif"
} as const;

export const ACCEPTED_FILE_TYPES = [
  FILE_EXTENSIONS.PDF,
  FILE_EXTENSIONS.TIFF,
  FILE_EXTENSIONS.TIF
] as const;
