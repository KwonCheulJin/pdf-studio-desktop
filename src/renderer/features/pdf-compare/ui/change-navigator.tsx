import { ChevronDown, ChevronUp } from "lucide-react";
import {
  COMPARE_RESULT_TEXT,
  NO_POSITION_TEXT
} from "../config/compare-result";
import type { ChangeNavigation } from "../model/use-change-navigation";

const STEP_ICON_SIZE = 14;

const STEP_BUTTON_CLASS =
  "border-border bg-card hover:bg-accent focus-visible:ring-ring flex h-7 items-center gap-1 rounded-sm border px-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

interface ChangeNavigatorProps {
  navigation: ChangeNavigation;
}

/** 이전/다음 이동과 위치 "3 / 25"(시안 4). 키보드 ↑↓·j/k도 같은 이동을 쓴다. */
export function ChangeNavigator({ navigation }: ChangeNavigatorProps) {
  const { position, total, previousId, nextId, goPrevious, goNext } =
    navigation;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={goPrevious}
        disabled={previousId === null}
        className={STEP_BUTTON_CLASS}
      >
        <ChevronUp size={STEP_ICON_SIZE} aria-hidden="true" />
        {COMPARE_RESULT_TEXT.PREVIOUS}
      </button>
      <span
        role="status"
        aria-label={COMPARE_RESULT_TEXT.POSITION}
        className="min-w-14 text-center font-mono text-xs"
      >
        {position ?? NO_POSITION_TEXT} / {total}
      </span>
      <button
        type="button"
        onClick={goNext}
        disabled={nextId === null}
        className={STEP_BUTTON_CLASS}
      >
        {COMPARE_RESULT_TEXT.NEXT}
        <ChevronDown size={STEP_ICON_SIZE} aria-hidden="true" />
      </button>
    </div>
  );
}
