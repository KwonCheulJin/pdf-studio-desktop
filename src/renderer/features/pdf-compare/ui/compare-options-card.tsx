import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { cn } from "@/renderer/shared/lib/utils";
import { Button } from "@/renderer/shared/ui";
import { COMPARE_SLOT } from "../config/compare-files";
import { COMPARE_OPTIONS_TEXT } from "../config/compare-options";
import {
  compareReadinessOf,
  isDefaultOptions,
  optionsSummaryOf
} from "../lib/compare-readiness";
import {
  useCompareOptions,
  useCompareSessionStore,
  useCompareSlotFile,
  useIsTextCompared
} from "../model/compare-session-store";
import { useCompareExecution } from "../model/use-compare-execution";
import { CompareTargetTable } from "./compare-target-table";
import { LineExclusionTable } from "./line-exclusion-table";
import { PageRangeFields } from "./page-range-fields";

const CHEVRON_SIZE = 16;
const PLAY_ICON_SIZE = 16;

/** 요약 배지(시안 3): 켠 비교 대상은 강조색, 나머지는 옅은 면 */
const BADGE_TONE_CLASS = {
  ACCENT: "bg-accent text-accent-foreground",
  NEUTRAL: "bg-muted text-foreground"
} as const;

interface SummaryBadgeProps {
  className: string;
  children: ReactNode;
}

function SummaryBadge({ className, children }: SummaryBadgeProps) {
  return (
    <span className={cn("rounded-full px-2 text-xs/5 font-medium", className)}>
      {children}
    </span>
  );
}

interface CompareOptionsCardProps {
  /** 바닥 줄의 "취소": 비교 화면을 떠난다. */
  onCancel: () => void;
}

/**
 * 실행 전 옵션 카드(계획서 P3-3, 시안 3 아래쪽). 머리(접기·요약 배지·기본값으로), 페이지 범위(A·B 따로),
 * 비교 대상 표·반복 줄 제외 표, 바닥 줄(실행할 수 없는 이유 또는 비교할 쪽수 / 취소 / ▶ 비교 실행).
 */
export function CompareOptionsCard({ onCancel }: CompareOptionsCardProps) {
  const titleId = useId();
  const bodyId = useId();
  const messageId = useId();
  const [isExpanded, setIsExpanded] = useState(true);
  const before = useCompareSlotFile(COMPARE_SLOT.BEFORE);
  const after = useCompareSlotFile(COMPARE_SLOT.AFTER);
  const options = useCompareOptions();
  const isTextCompared = useIsTextCompared();
  const resetOptions = useCompareSessionStore((state) => state.resetOptions);
  const { startCompare } = useCompareExecution();

  const readiness = compareReadinessOf({
    files: { [COMPARE_SLOT.BEFORE]: before, [COMPARE_SLOT.AFTER]: after },
    options,
    isTextCompared
  });
  const summary = optionsSummaryOf({ options, isTextCompared });
  const isDefault = isDefaultOptions({ options, isTextCompared });
  const isBlocked = readiness.blockReason !== null;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex shrink-0 flex-col rounded-xl border"
    >
      <div className="flex flex-wrap items-center gap-2.5 px-6 pt-4.5 pb-3.5">
        <h2 className="flex">
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={bodyId}
            onClick={() => setIsExpanded((expanded) => !expanded)}
            className="focus-visible:ring-ring flex items-center gap-2 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            <Chevron size={CHEVRON_SIZE} aria-hidden="true" />
            <span id={titleId} className="text-lg/6.5 font-semibold">
              {COMPARE_OPTIONS_TEXT.TITLE}
            </span>
          </button>
        </h2>
        <SummaryBadge
          className={
            summary.isTextCompared
              ? BADGE_TONE_CLASS.ACCENT
              : BADGE_TONE_CLASS.NEUTRAL
          }
        >
          {summary.target}
        </SummaryBadge>
        <SummaryBadge className={BADGE_TONE_CLASS.NEUTRAL}>
          {summary.exclusions}
        </SummaryBadge>
        <SummaryBadge className={BADGE_TONE_CLASS.NEUTRAL}>
          {summary.range}
        </SummaryBadge>
        <span className="grow" />
        <button
          type="button"
          disabled={isDefault}
          onClick={resetOptions}
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring h-7 rounded-sm px-2.5 text-[13px] transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        >
          {COMPARE_OPTIONS_TEXT.RESET}
        </button>
      </div>

      <div
        id={bodyId}
        hidden={!isExpanded}
        className="flex flex-col gap-4 px-6 pb-5"
      >
        <PageRangeFields ranges={readiness.ranges} />
        <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start gap-4">
          <CompareTargetTable />
          <LineExclusionTable />
        </div>
      </div>

      <div className="border-border flex flex-wrap items-center gap-3 border-t px-6 py-3.5">
        <p
          id={messageId}
          className={cn(
            "text-[13px]",
            isBlocked ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {readiness.message}
        </p>
        <span className="grow" />
        <Button
          variant="outline"
          onClick={onCancel}
          className="bg-card h-11.5 rounded-md px-5 font-normal"
        >
          {COMPARE_OPTIONS_TEXT.CANCEL}
        </Button>
        <Button
          disabled={isBlocked}
          aria-describedby={messageId}
          onClick={() => void startCompare()}
          className="h-11 rounded-md px-5.5 text-[15px] font-semibold"
        >
          <Play size={PLAY_ICON_SIZE} fill="currentColor" aria-hidden="true" />
          {COMPARE_OPTIONS_TEXT.RUN}
        </Button>
      </div>
    </section>
  );
}
