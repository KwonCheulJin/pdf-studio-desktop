import type { PageKind, ParagraphStatus } from "@/renderer/shared/api/bindings";

/** 결과 쪽 종류(계약 값, ADR 0002 §10 `TranslatedPage.kind`) */
export const PAGE_KIND = {
  TEXT_LAYER: "textLayer",
  IMAGE: "image",
  SCAN_SKIPPED: "scanSkipped",
  OUT_OF_RANGE: "outOfRange"
} as const satisfies Record<string, PageKind>;

/** 결과 문단 상태(계약 값, ADR 0002 §10 `TranslatedParagraph.status`) */
export const PARAGRAPH_STATUS = {
  TRANSLATED: "translated",
  EDITED: "edited",
  FAILED: "failed",
  REFUSED: "refused"
} as const satisfies Record<string, ParagraphStatus>;
