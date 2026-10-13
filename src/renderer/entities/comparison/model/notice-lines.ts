import type {
  CompareOptions,
  CompareResult,
  Notice,
  Side
} from "@/renderer/shared/api/bindings";
import { formatPageRange } from "@/renderer/shared/lib/page-range-format";
import {
  COMPARE_SIDE,
  COMPARE_SIDE_BADGE,
  COMPARE_SIDES,
  OCR_TEXT_SOURCE
} from "../config/change-kind";
import { displayPageNumber } from "./change-text";

/** 줄 제외 옵션 → 안내 띠에 쓰는 이름(옵션 순서) */
const EXCLUDED_LINE_LABEL = [
  { option: "excludeHeader", label: "머리말" },
  { option: "excludeFooter", label: "꼬리말" },
  { option: "excludePageNumbers", label: "쪽번호" }
] as const satisfies readonly {
  option: keyof CompareOptions;
  label: string;
}[];

const NOTICE_KIND = {
  LOW_TEXT_CONFIDENCE: "lowTextConfidence",
  NO_TEXT_LAYER: "noTextLayer",
  TRUNCATED: "truncated"
} as const satisfies Record<string, Notice["kind"]>;

const NO_TEXT_REASON_OCR_FAILED = "ocrFailed";

/** 한글 음절(가~힣)과 받침 수(종성 없음 포함 28) */
const HANGUL_SYLLABLE = { FIRST: 0xac00, LAST: 0xd7a3, FINAL_COUNT: 28 };

/** 마지막 글자에 받침이 있는가(조사 고르기) */
function hasFinalConsonant(word: string): boolean {
  const code = word.charCodeAt(word.length - 1);
  if (code < HANGUL_SYLLABLE.FIRST || code > HANGUL_SYLLABLE.LAST) {
    return false;
  }
  return (code - HANGUL_SYLLABLE.FIRST) % HANGUL_SYLLABLE.FINAL_COUNT !== 0;
}

/** "머리말과 꼬리말", "머리말, 꼬리말과 쪽번호" */
function joinWithAnd(words: readonly string[]): string {
  if (words.length < 2) return words.join("");
  const head = words.slice(0, -1);
  const lastHead = head[head.length - 1];
  const conjunction = hasFinalConsonant(lastHead) ? "과" : "와";
  return `${head.join(", ")}${conjunction} ${words[words.length - 1]}`;
}

function objectParticle(word: string): string {
  return hasFinalConsonant(word) ? "을" : "를";
}

function pagesText(pages: readonly number[]): string {
  return formatPageRange(pages.map(displayPageNumber));
}

function excludedLinesLine(options: CompareOptions): string[] {
  const labels = EXCLUDED_LINE_LABEL.filter(
    ({ option }) => options[option]
  ).map(({ label }) => label);
  if (labels.length === 0) return [];
  const joined = joinWithAnd(labels);
  return [
    `${joined}${objectParticle(labels[labels.length - 1])} 양쪽에서 뺐어요`
  ];
}

function ocrPagesLine(result: CompareResult): string[] {
  const parts = COMPARE_SIDES.flatMap((side: Side) => {
    const count = result.pageSources[side].filter(
      (source) => source === OCR_TEXT_SOURCE
    ).length;
    return count === 0 ? [] : [`${COMPARE_SIDE_BADGE[side]} ${count}개`];
  });
  return parts.length === 0 ? [] : [`OCR로 읽은 쪽 ${parts.join(" · ")}`];
}

function noticeLine(notice: Notice): string {
  switch (notice.kind) {
    case NOTICE_KIND.LOW_TEXT_CONFIDENCE:
      return `${COMPARE_SIDE_BADGE[notice.side]}의 ${pagesText(notice.pages)}쪽은 글자층이 깨져 있어 결과가 정확하지 않을 수 있어요`;
    case NOTICE_KIND.NO_TEXT_LAYER:
      return notice.reason === NO_TEXT_REASON_OCR_FAILED
        ? `${COMPARE_SIDE_BADGE[notice.side]}의 ${pagesText(notice.pages)}쪽은 OCR로 글자를 읽지 못해 비교하지 못했어요`
        : `${COMPARE_SIDE_BADGE[notice.side]}의 ${pagesText(notice.pages)}쪽은 글자층이 없어 비교하지 못했어요`;
    default:
      return `${COMPARE_SIDE_BADGE[COMPARE_SIDE.BEFORE]} ${pagesText(notice.beforePages)}쪽 · ${COMPARE_SIDE_BADGE[COMPARE_SIDE.AFTER]} ${pagesText(notice.afterPages)}쪽은 바뀐 곳이 많아 구간을 통째로 표시했어요`;
  }
}

interface NoticeLinesParams {
  result: CompareResult;
  /** 비교할 때 쓴 옵션(뺀 줄) */
  options: CompareOptions;
}

/**
 * 결과 위 안내 띠의 줄(계획서 P3-4): 뺀 반복 줄, OCR로 읽은 쪽 수, `notices`(ADR 0001 §6 순서).
 */
export function noticeLinesOf({
  result,
  options
}: NoticeLinesParams): string[] {
  return [
    ...excludedLinesLine(options),
    ...ocrPagesLine(result),
    ...result.notices.map(noticeLine)
  ];
}
