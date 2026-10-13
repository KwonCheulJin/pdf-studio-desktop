import type { Change, PageSources, Side } from "@/renderer/shared/api/bindings";
import {
  COMPARE_SIDE,
  COMPARE_SIDE_BADGE,
  COMPARE_SIDES,
  COMPARISON_TEXT,
  OCR_TEXT_SOURCE
} from "../config/change-kind";
import type { PagePair } from "./change-rows";

/** 화면에 보이는 쪽 번호(0부터 센 번호 + 1, ADR 0001 §3) */
export function displayPageNumber(page: number): number {
  return page + 1;
}

/** 목록 한 줄 요약: 추가는 B 글자, 삭제는 A 글자, 변경은 "A → B"(시안 4) */
export function changeSummary(change: Change): string {
  const before = change.before?.text;
  const after = change.after?.text;
  if (before !== undefined && after !== undefined) {
    return `${before} → ${after}`;
  }
  return before ?? after ?? "";
}

interface PageOfPairParams {
  pair: PagePair;
  side: Side;
}

export function pageOfPair({ pair, side }: PageOfPairParams): number | null {
  return side === COMPARE_SIDE.BEFORE ? pair[0] : pair[1];
}

/**
 * 쪽 묶음 머리의 쪽: 두 쪽 번호가 같으면 "2쪽", 다르면 "A 2쪽 · B 3쪽", 한쪽만 있으면 "B 3쪽".
 * 조항 제목(시안 "제4조 대금 지급")은 결과 모델에 없어 쓰지 않는다(토큰 문서 §6.5).
 */
export function pairPagesLabel(pair: PagePair): string {
  const [before, after] = pair;
  if (before !== null && after !== null && before === after) {
    return `${displayPageNumber(before)}쪽`;
  }
  return COMPARE_SIDES.flatMap((side) => {
    const page = pageOfPair({ pair, side });
    return page === null
      ? []
      : [`${COMPARE_SIDE_BADGE[side]} ${displayPageNumber(page)}쪽`];
  }).join(" · ");
}

interface IsOcrPageParams {
  pageSources: PageSources;
  side: Side;
  page: number;
}

/** `page_sources`가 OCR인 쪽(글자를 OCR로 읽었다) */
export function isOcrPage({
  pageSources,
  side,
  page
}: IsOcrPageParams): boolean {
  return pageSources[side][page] === OCR_TEXT_SOURCE;
}

interface PairOcrLabelParams {
  pair: PagePair;
  pageSources: PageSources;
}

/**
 * 쪽 묶음 머리의 OCR 배지 글자. 행에 있는 쪽이 모두 OCR이면 "OCR", 한쪽만이면 "B OCR".
 * OCR 쪽이 없으면 `null`.
 */
export function pairOcrLabel({
  pair,
  pageSources
}: PairOcrLabelParams): string | null {
  const presentSides = COMPARE_SIDES.filter(
    (side) => pageOfPair({ pair, side }) !== null
  );
  const ocrSides = presentSides.filter((side) => {
    const page = pageOfPair({ pair, side });
    return page !== null && isOcrPage({ pageSources, side, page });
  });
  if (ocrSides.length === 0) return null;
  if (ocrSides.length === presentSides.length) return COMPARISON_TEXT.OCR;
  return `${COMPARE_SIDE_BADGE[ocrSides[0]]} ${COMPARISON_TEXT.OCR}`;
}
