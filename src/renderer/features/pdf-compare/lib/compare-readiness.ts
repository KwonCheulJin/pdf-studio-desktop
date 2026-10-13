import type { CompareOptions } from "@/renderer/shared/api/bindings";
import {
  parsePageRange,
  type PageRangeError
} from "@/renderer/shared/lib/page-range-parse";
import {
  COMPARE_SLOT,
  COMPARE_SLOT_LABEL,
  COMPARE_SLOTS,
  type CompareSlot
} from "../config/compare-files";
import {
  COMPARE_OPTIONS_TEXT,
  compareRunMessage,
  DEFAULT_COMPARE_OPTIONS,
  LINE_EXCLUSION_ORDER,
  RANGE_OPTION_KEY
} from "../config/compare-options";
import type { CompareFile } from "../model/compare-session-store";

/** 한 슬롯의 쪽 범위 검사 결과. 문서가 없으면 쪽 수를 몰라 검사하지 않는다. */
export interface SlotRange {
  error: PageRangeError | null;
  /** 비교할 쪽 수. 문서가 없거나 범위가 잘못됐으면 `null` */
  selectedPageCount: number | null;
}

interface SlotRangeParams {
  file: CompareFile | null;
  range: string;
}

export function slotRangeOf({ file, range }: SlotRangeParams): SlotRange {
  if (!file) {
    return { error: null, selectedPageCount: null };
  }
  const parsed = parsePageRange({ input: range, pageCount: file.pageCount });
  return parsed.isValid
    ? { error: null, selectedPageCount: parsed.pages.length }
    : { error: parsed.error, selectedPageCount: null };
}

export interface CompareSetup {
  files: Record<CompareSlot, CompareFile | null>;
  options: CompareOptions;
  isTextCompared: boolean;
}

export interface CompareReadiness {
  ranges: Record<CompareSlot, SlotRange>;
  /** 실행할 수 없는 이유. 없으면 실행할 수 있다. */
  blockReason: string | null;
  /** 실행 줄 문구: 이유, 또는 "A 18쪽 · B 19쪽을 비교해요" */
  message: string;
}

function badgesOf(slots: readonly CompareSlot[]): string[] {
  return slots.map((slot) => COMPARE_SLOT_LABEL[slot].badge);
}

/**
 * 실행 전 옵션 카드 바닥 줄(계획서 P3-3): 문서가 다 있는지 → 쪽 범위가 맞는지 → 비교 대상이 켜졌는지
 * 순서로 막는 이유를 찾는다.
 */
export function compareReadinessOf({
  files,
  options,
  isTextCompared
}: CompareSetup): CompareReadiness {
  const ranges = {
    [COMPARE_SLOT.BEFORE]: slotRangeOf({
      file: files[COMPARE_SLOT.BEFORE],
      range: options[RANGE_OPTION_KEY[COMPARE_SLOT.BEFORE]]
    }),
    [COMPARE_SLOT.AFTER]: slotRangeOf({
      file: files[COMPARE_SLOT.AFTER],
      range: options[RANGE_OPTION_KEY[COMPARE_SLOT.AFTER]]
    })
  };
  const missingSlots = COMPARE_SLOTS.filter((slot) => files[slot] === null);
  const invalidSlots = COMPARE_SLOTS.filter(
    (slot) => ranges[slot].error !== null
  );

  let blockReason: string | null = null;
  if (missingSlots.length > 0) {
    blockReason = compareRunMessage.missingFiles(badgesOf(missingSlots));
  } else if (invalidSlots.length > 0) {
    blockReason = compareRunMessage.invalidRanges(badgesOf(invalidSlots));
  } else if (!isTextCompared) {
    blockReason = COMPARE_OPTIONS_TEXT.REASON_NO_TARGET;
  }
  const message =
    blockReason ??
    compareRunMessage.ready({
      beforePages: ranges[COMPARE_SLOT.BEFORE].selectedPageCount ?? 0,
      afterPages: ranges[COMPARE_SLOT.AFTER].selectedPageCount ?? 0
    });
  return { ranges, blockReason, message };
}

interface OptionsSummaryParams {
  options: CompareOptions;
  isTextCompared: boolean;
}

export interface OptionsSummary {
  /** "글자 비교" 또는 "대상 없음" */
  target: string;
  /** "2줄 제외" 또는 "제외 없음" */
  exclusions: string;
  /** "범위 지정" 또는 "전체 쪽" */
  range: string;
  isTextCompared: boolean;
}

export function excludedLineCountOf(options: CompareOptions): number {
  return LINE_EXCLUSION_ORDER.filter((exclusion) => options[exclusion]).length;
}

/** 접은 카드 머리의 요약 배지(켠 비교 대상, 뺀 줄 수, 전체/범위 지정) */
export function optionsSummaryOf({
  options,
  isTextCompared
}: OptionsSummaryParams): OptionsSummary {
  const excludedCount = excludedLineCountOf(options);
  const hasRange = COMPARE_SLOTS.some(
    (slot) => options[RANGE_OPTION_KEY[slot]].trim() !== ""
  );
  return {
    target: isTextCompared
      ? COMPARE_OPTIONS_TEXT.SUMMARY_TEXT_TARGET
      : COMPARE_OPTIONS_TEXT.SUMMARY_NO_TARGET,
    exclusions:
      excludedCount > 0
        ? compareRunMessage.excludedLines(excludedCount)
        : COMPARE_OPTIONS_TEXT.SUMMARY_NO_EXCLUSION,
    range: hasRange
      ? COMPARE_OPTIONS_TEXT.SUMMARY_RANGE
      : COMPARE_OPTIONS_TEXT.SUMMARY_ALL_PAGES,
    isTextCompared
  };
}

/** 옵션이 기본값 그대로인가("기본값으로"를 막는다) */
export function isDefaultOptions({
  options,
  isTextCompared
}: OptionsSummaryParams): boolean {
  const keys = Object.keys(DEFAULT_COMPARE_OPTIONS) as (keyof CompareOptions)[];
  return (
    isTextCompared &&
    keys.every((key) => options[key] === DEFAULT_COMPARE_OPTIONS[key])
  );
}
