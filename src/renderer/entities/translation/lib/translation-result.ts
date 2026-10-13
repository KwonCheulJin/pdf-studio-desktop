import type { TranslationResult } from "@/renderer/shared/api/bindings";
import { PAGE_KIND } from "../config/translation-result";

/** 문서 첫 쪽(쪽 번호는 0부터, ADR 0001 §3) */
const FIRST_PAGE = 0;

/** 결과의 문단 수(모든 쪽, 실패·거절 문단 포함). 상태바 `문단 318개` */
export function paragraphCountOf(result: TranslationResult): number {
  return result.pages.reduce(
    (count, page) => count + page.paragraphs.length,
    0
  );
}

/** 번역 범위 안 쪽 수(범위 밖 쪽을 뺀다). 결과 머리 `22쪽` */
export function rangePageCountOf(result: TranslationResult): number {
  return result.pages.filter((page) => page.kind !== PAGE_KIND.OUT_OF_RANGE)
    .length;
}

/** 결과 화면이 처음 보일 쪽(0부터): 범위 안 첫 쪽, 없으면 첫 쪽 */
export function firstRangePageOf(result: TranslationResult): number {
  const first = result.pages.find(
    (page) => page.kind !== PAGE_KIND.OUT_OF_RANGE
  );
  return first?.page ?? FIRST_PAGE;
}
