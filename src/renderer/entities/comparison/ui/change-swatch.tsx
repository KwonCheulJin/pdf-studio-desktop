import type { ChangeKind } from "@/renderer/shared/api/bindings";
import { cn } from "@/renderer/shared/lib/utils";
import { CHANGE_KIND_STYLE, NEEDS_REVIEW_STYLE } from "../config/change-kind";

interface ChangeSwatchProps {
  /** 없으면 "확인 필요" 견본 */
  kind: ChangeKind | null;
  className?: string;
}

/** 범례 칩·목록 항목의 10px 견본. 페이지 상자와 같은 색·선 모양이다(시안 4). */
export function ChangeSwatch({ kind, className }: ChangeSwatchProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "rounded-paper size-2.5 shrink-0",
        kind === null
          ? NEEDS_REVIEW_STYLE.swatch
          : CHANGE_KIND_STYLE[kind].swatch,
        className
      )}
    />
  );
}
