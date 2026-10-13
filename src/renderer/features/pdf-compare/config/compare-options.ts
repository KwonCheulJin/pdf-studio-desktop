import type { CompareOptions } from "@/renderer/shared/api/bindings";
import {
  PAGE_RANGE_ERROR,
  type PageRangeError
} from "@/renderer/shared/lib/page-range-parse";
import type { ValueOf } from "@/renderer/shared/types/common";
import { COMPARE_SLOT, type CompareSlot } from "./compare-files";

/** 실행 전 옵션의 기본값: 전체 쪽, 제외 없음, 대소문자 구분(Rust `CompareOptions::default`와 같다) */
export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
  rangeA: "",
  rangeB: "",
  excludeHeader: false,
  excludeFooter: false,
  excludePageNumbers: false,
  ignoreCase: false
};

/** 슬롯마다의 쪽 범위 옵션(A·B 따로) */
export const RANGE_OPTION_KEY = {
  [COMPARE_SLOT.BEFORE]: "rangeA",
  [COMPARE_SLOT.AFTER]: "rangeB"
} as const satisfies Record<CompareSlot, keyof CompareOptions>;

export const RANGE_PLACEHOLDER = "1,3-5";

/** 반복 줄 제외 옵션(양쪽 문서에 같이 적용) */
export const LINE_EXCLUSION = {
  HEADER: "excludeHeader",
  FOOTER: "excludeFooter",
  PAGE_NUMBERS: "excludePageNumbers"
} as const satisfies Record<string, keyof CompareOptions>;

export type LineExclusion = ValueOf<typeof LINE_EXCLUSION>;

export const LINE_EXCLUSION_ORDER: readonly LineExclusion[] = [
  LINE_EXCLUSION.HEADER,
  LINE_EXCLUSION.FOOTER,
  LINE_EXCLUSION.PAGE_NUMBERS
];

export const LINE_EXCLUSION_LABEL: Record<LineExclusion, string> = {
  [LINE_EXCLUSION.HEADER]: "머리말",
  [LINE_EXCLUSION.FOOTER]: "꼬리말",
  [LINE_EXCLUSION.PAGE_NUMBERS]: "쪽번호"
};

interface CompareTarget {
  name: string;
  description: string;
}

/** 비교 대상 "글자"와 하위 옵션 "대소문자" */
export const TEXT_TARGET: CompareTarget = {
  name: "글자",
  description: "추가, 삭제, 바뀐 글자"
};

export const IGNORE_CASE_OPTION: CompareTarget = {
  name: "대소문자",
  description: "A와 a를 같은 글자로 봐요"
};

/** 아직 비교하지 않는 대상(계획서 Phase 5). 표에 "준비 중"으로 꺼 둔다. */
export const UPCOMING_TARGETS: readonly CompareTarget[] = [
  { name: "스타일", description: "글자는 같고 글꼴, 크기만 바뀐 곳" },
  { name: "레이아웃", description: "내용은 같고 위치만 옮겨진 곳" },
  { name: "그림", description: "선, 도형 같은 벡터 그림" }
];

/** 비교 대상 표의 전체 개수(글자 + 준비 중) */
export const COMPARE_TARGET_COUNT = 1 + UPCOMING_TARGETS.length;

export const COMPARE_OPTIONS_TEXT = {
  TITLE: "실행 전 옵션",
  RESET: "기본값으로",
  RANGE_LABEL: "페이지 범위",
  RANGE_HINT: "(비우면 전체)",
  TARGET_TITLE: "비교 대상",
  TARGET_DEFAULT_BADGE: "기본",
  TARGET_UPCOMING_BADGE: "준비 중",
  EXCLUSION_TITLE: "반복 줄 제외",
  EXCLUSION_BOTH_SIDES: "양쪽 문서에서 같이 빼요",
  CANCEL: "취소",
  RUN: "비교 실행",
  SUMMARY_TEXT_TARGET: "글자 비교",
  SUMMARY_NO_TARGET: "대상 없음",
  SUMMARY_NO_EXCLUSION: "제외 없음",
  SUMMARY_RANGE: "범위 지정",
  SUMMARY_ALL_PAGES: "전체 쪽",
  REASON_NO_TARGET: "비교 대상을 켜면 실행할 수 있어요."
} as const;

/** 쪽 범위 오류 문구. 쪽 수를 넘을 때만 문서와 쪽 수를 넣는다. */
const RANGE_ERROR_MESSAGE: Record<
  Exclude<PageRangeError, typeof PAGE_RANGE_ERROR.EXCEEDS_PAGE_COUNT>,
  string
> = {
  [PAGE_RANGE_ERROR.FORMAT]: "쪽 번호는 1부터 1,3-5처럼 써 주세요.",
  [PAGE_RANGE_ERROR.REVERSED]: "구간은 작은 쪽부터 써 주세요(예: 3-5)."
};

interface RangeErrorMessageParams {
  error: PageRangeError;
  /** 문서 배지(A·B) */
  badge: string;
  pageCount: number;
}

/** 시안 3: "B 문서는 19쪽까지 있어요. 범위를 줄이세요." */
export function rangeErrorMessage({
  error,
  badge,
  pageCount
}: RangeErrorMessageParams): string {
  return error === PAGE_RANGE_ERROR.EXCEEDS_PAGE_COUNT
    ? `${badge} 문서는 ${pageCount}쪽까지 있어요. 범위를 줄이세요.`
    : RANGE_ERROR_MESSAGE[error];
}

interface ComparedPageCounts {
  beforePages: number;
  afterPages: number;
}

/** 실행 줄의 문구(이유가 있으면 실행 버튼이 막힌다) */
export const compareRunMessage = {
  missingFiles: (badges: readonly string[]) =>
    `${badges.join("·")} 문서를 넣으면 실행할 수 있어요.`,
  invalidRanges: (badges: readonly string[]) =>
    `${badges.join("·")}의 페이지 범위를 고치면 실행할 수 있어요.`,
  ready: ({ beforePages, afterPages }: ComparedPageCounts) =>
    `A ${beforePages}쪽 · B ${afterPages}쪽을 비교해요`,
  excludedLines: (count: number) => `${count}줄 제외`,
  targetCount: (count: number) => `${count} / ${COMPARE_TARGET_COUNT} 켬`,
  exclusionCount: (count: number) =>
    `${count} / ${LINE_EXCLUSION_ORDER.length} 뺌`
} as const;
