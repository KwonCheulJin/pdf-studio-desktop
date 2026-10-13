import type { TranslationResult } from "@/renderer/shared/api/bindings";

/** 결과의 문단 수(모든 쪽, 실패·거절 문단 포함). 상태바 `문단 318개` */
export function paragraphCountOf(result: TranslationResult): number {
  return result.pages.reduce(
    (count, page) => count + page.paragraphs.length,
    0
  );
}
