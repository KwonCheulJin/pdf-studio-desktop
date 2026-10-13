import type { ResultViewMode } from "@/renderer/features/pdf-translate";
import { cn } from "@/renderer/shared/lib/utils";
import {
  VIEW_MODE_LABEL,
  VIEW_MODE_ORDER,
  VIEWER_TEXT
} from "../config/viewer";

interface ViewModeToggleProps {
  value: ResultViewMode;
  onChange: (viewMode: ResultViewMode) => void;
}

/** 보기 방식 `나란히 | 번역만 | 원문만`(시안 13: 바탕 `secondary`, 고른 칸은 카드색. 비교 결과와 같은 모양) */
export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div
      role="group"
      aria-label={VIEWER_TEXT.VIEW_MODE}
      className="bg-secondary inline-flex gap-0.5 rounded-md p-0.5"
    >
      {VIEW_MODE_ORDER.map((mode) => {
        const isActive = mode === value;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(mode)}
            className={cn(
              "focus-visible:ring-ring h-6.5 rounded-sm px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "bg-card text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {VIEW_MODE_LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}
