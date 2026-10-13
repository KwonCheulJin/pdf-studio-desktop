import { cn } from "@/renderer/shared/lib/utils";
import {
  COMPARE_RESULT_TEXT,
  COMPARE_VIEW_MODE_LABEL,
  COMPARE_VIEW_MODES
} from "../config/compare-result";
import {
  useCompareSessionStore,
  useCompareViewMode
} from "../model/compare-session-store";

/** 보기 방식 `나란히 | A만 | B만`(시안 4: 바탕 `secondary`, 고른 칸은 카드색) */
export function ViewModeToggle() {
  const viewMode = useCompareViewMode();
  const setViewMode = useCompareSessionStore((state) => state.setViewMode);
  return (
    <div
      role="group"
      aria-label={COMPARE_RESULT_TEXT.VIEW_MODE}
      className="bg-secondary inline-flex gap-0.5 rounded-md p-0.5"
    >
      {COMPARE_VIEW_MODES.map((mode) => {
        const isActive = mode === viewMode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={isActive}
            onClick={() => setViewMode(mode)}
            className={cn(
              "focus-visible:ring-ring h-6.5 rounded-sm px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "bg-card text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {COMPARE_VIEW_MODE_LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}
