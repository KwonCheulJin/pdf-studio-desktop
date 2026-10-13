import type {
  TranslatedParagraph,
  TranslationResult
} from "@/renderer/shared/api/bindings";
import { PAGE_KIND, PARAGRAPH_STATUS } from "../config/translation-result";

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

/** 번역 글 대신 이유를 보이는 상태(실패·거절, 계획서 P6-11 "문단 상태") */
const UNTRANSLATED_STATUSES: ReadonlySet<TranslatedParagraph["status"]> =
  new Set([PARAGRAPH_STATUS.FAILED, PARAGRAPH_STATUS.REFUSED]);

/** 번역하지 못한(실패·거절) 문단인지 */
export function isUntranslatedParagraph(
  paragraph: TranslatedParagraph
): boolean {
  return UNTRANSLATED_STATUSES.has(paragraph.status);
}
