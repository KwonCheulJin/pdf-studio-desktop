import { useId, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { noticeLinesOf } from "@/renderer/entities/comparison";
import {
  COMPARE_RESULT_TEXT,
  compareResultMessage
} from "../config/compare-result";
import { useCompletedComparison } from "../model/compare-session-store";

const INFO_ICON_SIZE = 14;
const LINE_SEPARATOR = " · ";

/**
 * 결과 위 안내 띠(시안 4): 뺀 반복 줄, OCR로 읽은 쪽 수, `notices`를 한 줄로 잇고 "자세히"로 줄마다
 * 펼친다. 안내가 없으면 띠를 두지 않는다.
 */
export function CompareNoticesBand() {
  const completed = useCompletedComparison();
  const [isExpanded, setIsExpanded] = useState(false);
  const detailId = useId();
  const lines = useMemo(
    () =>
      completed
        ? noticeLinesOf({
            result: completed.result,
            options: completed.options
          })
        : [],
    [completed]
  );
  if (lines.length === 0) return null;

  return (
    <section
      aria-label={COMPARE_RESULT_TEXT.NOTICES}
      className="bg-muted border-border text-muted-foreground shrink-0 border-b px-6 py-1.5 text-xs/4.25"
    >
      <div className="flex min-h-4.5 items-center gap-2">
        <Info size={INFO_ICON_SIZE} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 truncate">
          <b className="text-foreground font-medium">
            {compareResultMessage.notices(lines.length)}
          </b>
          {!isExpanded && `${LINE_SEPARATOR}${lines.join(LINE_SEPARATOR)}`}
        </span>
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={detailId}
          onClick={() => setIsExpanded((expanded) => !expanded)}
          className="text-accent-foreground focus-visible:ring-ring shrink-0 rounded-xs hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          {isExpanded
            ? COMPARE_RESULT_TEXT.NOTICES_LESS
            : COMPARE_RESULT_TEXT.NOTICES_MORE}
        </button>
      </div>
      {isExpanded && (
        <ul id={detailId} className="mt-1 list-disc pl-10">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
