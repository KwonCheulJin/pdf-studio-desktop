import type { ValueOf } from "@/renderer/shared/types/common";

/**
 * 쪽 범위 문자열(`"1,3-5"`)을 읽지 못한 이유. 받을지 거부할지는 Rust `parse_page_range`
 * (ADR 0001 §13)와 같고, 이유는 화면 문구를 고르려고 나눈다.
 */
export const PAGE_RANGE_ERROR = {
  /** 숫자가 아닌 글자, 빈 항목(`1,,2`·끝 쉼표), 0 */
  FORMAT: "format",
  /** 뒤 번호가 앞 번호보다 작은 구간(`5-3`) */
  REVERSED: "reversed",
  /** 문서 쪽 수를 넘는 번호 */
  EXCEEDS_PAGE_COUNT: "exceedsPageCount"
} as const;

export type PageRangeError = ValueOf<typeof PAGE_RANGE_ERROR>;

interface ValidPageRange {
  isValid: true;
  /** 0부터 센 쪽 번호(오름차순, 중복 없음) */
  pages: number[];
}

interface InvalidPageRange {
  isValid: false;
  error: PageRangeError;
}

export type PageRangeParseResult = ValidPageRange | InvalidPageRange;

interface ParsePageRangeParams {
  input: string;
  pageCount: number;
}

/** 1부터 센 쪽 번호 구간(양 끝 포함) */
interface PageSpan {
  first: number;
  last: number;
}

interface ParseItemParams {
  item: string;
  pageCount: number;
}

const ITEM_SEPARATOR = ",";
const SPAN_SEPARATOR = "-";
const DIGITS_PATTERN = /^[0-9]+$/;
const FIRST_PAGE = 1;

/** 앞뒤 공백을 뗀 10진수(부호 없음). 숫자가 아니면 `null` */
function parsePageNumber(text: string): number | null {
  const digits = text.trim();
  return DIGITS_PATTERN.test(digits) ? Number(digits) : null;
}

/** 항목 하나(`N` 또는 `N-M`, 첫 `-`에서 나눈다)를 구간으로. 읽지 못하면 이유 */
function parseItem({
  item,
  pageCount
}: ParseItemParams): PageSpan | PageRangeError {
  const separatorIndex = item.indexOf(SPAN_SEPARATOR);
  const [firstText, lastText] =
    separatorIndex < 0
      ? [item, item]
      : [item.slice(0, separatorIndex), item.slice(separatorIndex + 1)];
  const first = parsePageNumber(firstText);
  const last = parsePageNumber(lastText);
  if (first === null || last === null || first < FIRST_PAGE) {
    return PAGE_RANGE_ERROR.FORMAT;
  }
  if (first > last) return PAGE_RANGE_ERROR.REVERSED;
  if (last > pageCount) return PAGE_RANGE_ERROR.EXCEEDS_PAGE_COUNT;
  return { first, last };
}

/**
 * 1부터 센 사용자 표기를 0부터 센 쪽 번호로 바꾼다. 비었거나 공백뿐이면 전체 쪽이다.
 * 순서가 뒤바뀌거나 겹친 입력(`"5,1"`, `"1-3,2"`)은 정렬하고 중복을 없애 받는다.
 * 잘못된 항목이 여럿이면 앞의 것이 이유다.
 */
export function parsePageRange({
  input,
  pageCount
}: ParsePageRangeParams): PageRangeParseResult {
  const allPages = Array.from({ length: pageCount }, (_, page) => page);
  if (input.trim() === "") {
    return { isValid: true, pages: allPages };
  }
  const items = input
    .split(ITEM_SEPARATOR)
    .map((item) => parseItem({ item, pageCount }));
  const error = items.find((item) => typeof item === "string");
  if (error !== undefined) {
    return { isValid: false, error };
  }
  const spans = items.filter((item) => typeof item !== "string");
  return {
    isValid: true,
    pages: allPages.filter((page) =>
      spans.some(
        (span) =>
          page + FIRST_PAGE >= span.first && page + FIRST_PAGE <= span.last
      )
    )
  };
}
