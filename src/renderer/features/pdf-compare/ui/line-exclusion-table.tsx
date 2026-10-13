import { useId } from "react";
import { cn } from "@/renderer/shared/lib/utils";
import { Checkbox } from "@/renderer/shared/ui";
import {
  COMPARE_OPTIONS_TEXT,
  compareRunMessage,
  LINE_EXCLUSION,
  LINE_EXCLUSION_LABEL,
  LINE_EXCLUSION_ORDER,
  type LineExclusion
} from "../config/compare-options";
import { excludedLineCountOf } from "../lib/compare-readiness";
import {
  useCompareOptions,
  useCompareSessionStore
} from "../model/compare-session-store";

/** 빼는 줄은 삭제 색으로 칠한다(시안 3). 남는 줄은 종이 글줄 색 */
const EXCLUDED_LINE_CLASS = "bg-diff-delete opacity-70";
const KEPT_LINE_CLASS = "bg-paper-line";
/** 본문 글줄 너비(시안 3의 100·90·96·70·94%) */
const BODY_LINE_WIDTH_CLASSES = [
  "w-full",
  "w-9/10",
  "w-24/25",
  "w-7/10",
  "w-47/50"
] as const;

interface PageIllustrationProps {
  excluded: Record<LineExclusion, boolean>;
}

/** 작은 페이지 그림: 머리말(위)·꼬리말(아래)·쪽번호(맨 아래 가운데) 중 빼는 줄을 칠한다. */
function PageIllustration({ excluded }: PageIllustrationProps) {
  const lineClass = (exclusion: LineExclusion) =>
    excluded[exclusion] ? EXCLUDED_LINE_CLASS : KEPT_LINE_CLASS;
  return (
    <div
      aria-hidden="true"
      className="bg-paper rounded-paper shadow-paper flex h-27.5 w-19.5 shrink-0 flex-col gap-1.25 px-2 py-1.5"
    >
      <div
        className={cn(
          "rounded-paper h-1 w-3/5",
          lineClass(LINE_EXCLUSION.HEADER)
        )}
      />
      {BODY_LINE_WIDTH_CLASSES.map((widthClass, index) => (
        <div
          key={widthClass}
          className={cn(
            "bg-paper-line rounded-paper h-0.75",
            widthClass,
            index === 0 && "mt-1.5"
          )}
        />
      ))}
      <span className="grow" />
      <div
        className={cn(
          "rounded-paper h-1 w-4/5",
          lineClass(LINE_EXCLUSION.FOOTER)
        )}
      />
      <div
        className={cn(
          "rounded-paper h-0.75 w-1/6 self-center",
          lineClass(LINE_EXCLUSION.PAGE_NUMBERS)
        )}
      />
    </div>
  );
}

/**
 * 반복 줄 제외 표(계획서 P3-3): 머리말·꼬리말·쪽번호를 따로 고른다. 양쪽 문서에 같이 적용하고,
 * 옆의 작은 페이지 그림에 빠지는 줄을 보인다.
 */
export function LineExclusionTable() {
  const titleId = useId();
  const options = useCompareOptions();
  const setLineExcluded = useCompareSessionStore(
    (state) => state.setLineExcluded
  );
  const excluded: Record<LineExclusion, boolean> = {
    [LINE_EXCLUSION.HEADER]: options.excludeHeader,
    [LINE_EXCLUSION.FOOTER]: options.excludeFooter,
    [LINE_EXCLUSION.PAGE_NUMBERS]: options.excludePageNumbers
  };

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="border-border overflow-hidden rounded-lg border"
    >
      <div className="bg-card-inset border-border flex items-center gap-2 border-b px-3.5 py-2.5">
        <span id={titleId} className="font-semibold">
          {COMPARE_OPTIONS_TEXT.EXCLUSION_TITLE}
        </span>
        <span className="text-muted-foreground text-xs">
          {compareRunMessage.exclusionCount(excludedLineCountOf(options))} ·{" "}
          {COMPARE_OPTIONS_TEXT.EXCLUSION_BOTH_SIDES}
        </span>
      </div>
      <div className="flex items-center gap-3 px-3.5 pt-1 pb-3">
        <div className="flex min-w-0 flex-1 flex-col">
          {LINE_EXCLUSION_ORDER.map((exclusion, index) => (
            <label
              key={exclusion}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2.5",
                index > 0 && "border-border min-h-10.25 border-t"
              )}
            >
              <Checkbox
                checked={excluded[exclusion]}
                aria-label={LINE_EXCLUSION_LABEL[exclusion]}
                onCheckedChange={(checked) =>
                  setLineExcluded({ exclusion, isExcluded: checked === true })
                }
              />
              {LINE_EXCLUSION_LABEL[exclusion]}
            </label>
          ))}
        </div>
        <PageIllustration excluded={excluded} />
      </div>
    </div>
  );
}
