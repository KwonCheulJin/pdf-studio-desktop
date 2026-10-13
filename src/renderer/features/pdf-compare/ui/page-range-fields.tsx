import { useId } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/renderer/shared/lib/utils";
import {
  COMPARE_SLOT_LABEL,
  COMPARE_SLOTS,
  type CompareSlot
} from "../config/compare-files";
import {
  COMPARE_OPTIONS_TEXT,
  RANGE_OPTION_KEY,
  RANGE_PLACEHOLDER,
  rangeErrorMessage
} from "../config/compare-options";
import type { SlotRange } from "../lib/compare-readiness";
import {
  useCompareOptions,
  useCompareSessionStore,
  useCompareSlotFile
} from "../model/compare-session-store";

const ERROR_ICON_SIZE = 14;

interface PageRangeFieldProps {
  slot: CompareSlot;
  range: SlotRange;
}

/**
 * 한 문서의 쪽 범위 입력(시안 3): A·B 배지 · 입력 · "/ N쪽". 높이는 시안이 그려지는 38px
 * (content-box `height: 36px` + 테두리)이다. 범위가 틀리면 빨간 테두리와
 * 아래 이유 문구. 문서가 없으면 쪽 수를 몰라 검사하지 않는다.
 */
function PageRangeField({ slot, range }: PageRangeFieldProps) {
  const inputId = useId();
  const errorId = useId();
  const file = useCompareSlotFile(slot);
  const value = useCompareOptions()[RANGE_OPTION_KEY[slot]];
  const setRange = useCompareSessionStore((state) => state.setRange);
  const { badge } = COMPARE_SLOT_LABEL[slot];
  const errorMessage =
    file && range.error
      ? rangeErrorMessage({
          error: range.error,
          badge,
          pageCount: file.pageCount
        })
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label
        htmlFor={inputId}
        className={cn(
          "bg-card focus-within:ring-ring flex h-9.5 items-center gap-2 rounded-sm border px-2.5 focus-within:ring-2",
          errorMessage ? "border-destructive" : "border-input"
        )}
      >
        <span
          aria-hidden="true"
          className="bg-foreground text-background inline-flex size-4 shrink-0 items-center justify-center rounded-xs text-[10px] font-semibold"
        >
          {badge}
        </span>
        <input
          id={inputId}
          type="text"
          value={value}
          placeholder={RANGE_PLACEHOLDER}
          autoComplete="off"
          spellCheck={false}
          aria-label={`${badge} ${COMPARE_OPTIONS_TEXT.RANGE_LABEL}`}
          aria-invalid={errorMessage !== null}
          aria-describedby={errorMessage ? errorId : undefined}
          onChange={(event) => setRange({ slot, range: event.target.value })}
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {file && (
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            / {file.pageCount}쪽
          </span>
        )}
      </label>
      {errorMessage && (
        <p
          id={errorId}
          className="text-destructive flex items-center gap-1 text-xs/4.25"
        >
          <CircleAlert
            size={ERROR_ICON_SIZE}
            aria-hidden="true"
            className="shrink-0"
          />
          {errorMessage}
        </p>
      )}
    </div>
  );
}

interface PageRangeFieldsProps {
  ranges: Record<CompareSlot, SlotRange>;
}

/** 페이지 범위 줄: A·B를 따로 입력한다(`"1,3-5"`, 비우면 전체). */
export function PageRangeFields({ ranges }: PageRangeFieldsProps) {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="bg-card-inset flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg px-4 py-3.5"
    >
      <span
        id={labelId}
        className="flex h-9.5 shrink-0 items-center gap-1 text-[13px] font-semibold"
      >
        {COMPARE_OPTIONS_TEXT.RANGE_LABEL}
        <span className="text-muted-foreground font-normal">
          {COMPARE_OPTIONS_TEXT.RANGE_HINT}
        </span>
      </span>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4">
        {COMPARE_SLOTS.map((slot) => (
          <PageRangeField key={slot} slot={slot} range={ranges[slot]} />
        ))}
      </div>
    </div>
  );
}
