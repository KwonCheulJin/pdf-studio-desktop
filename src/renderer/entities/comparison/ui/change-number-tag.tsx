import type { ChangeKind } from "@/renderer/shared/api/bindings";
import { cn } from "@/renderer/shared/lib/utils";
import { CHANGE_KIND_STYLE, NEEDS_REVIEW_STYLE } from "../config/change-kind";

interface ChangeNumberTagProps {
  changeId: string;
  number: number;
  kind: ChangeKind;
  needsReview: boolean;
  /** 상자 오른쪽 끝·위 끝의 쪽 안 위치(쪽 너비·높이에 대한 %) */
  leftPercent: number;
  topPercent: number;
}

/**
 * 페이지 위 변경 상자 옆 번호 태그(목록 `#n`과 같은 번호). 시안 4: 상자 오른쪽 6px·위 2px,
 * mono 10/16, 종류 색 바탕. "확인 필요"는 `warning` 바탕이다.
 */
export function ChangeNumberTag({
  changeId,
  number,
  kind,
  needsReview,
  leftPercent,
  topPercent
}: ChangeNumberTagProps) {
  return (
    <span
      aria-hidden="true"
      data-number-tag={changeId}
      className={cn(
        "pointer-events-none absolute -mt-0.5 ml-1.5 rounded-xs px-1 font-mono text-[10px]/4",
        needsReview
          ? NEEDS_REVIEW_STYLE.tag
          : cn(CHANGE_KIND_STYLE[kind].solid, "text-media-foreground")
      )}
      style={{ left: `${leftPercent}%`, top: `${topPercent}%` }}
    >
      {number}
    </span>
  );
}
