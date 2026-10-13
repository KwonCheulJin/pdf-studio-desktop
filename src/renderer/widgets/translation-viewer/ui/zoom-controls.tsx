import { Minus, Plus } from "lucide-react";
import { RESULT_ZOOM } from "@/renderer/features/pdf-translate";
import { VIEWER_TEXT, viewerText } from "../config/viewer";

const ZOOM_ICON_SIZE = 14;

const ZOOM_BUTTON_CLASS =
  "hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

interface ZoomControlsProps {
  zoomPercent: number;
  /** 바꿀 배율(%). 범위는 받는 쪽이 자른다. */
  onChange: (zoomPercent: number) => void;
}

/** 글자 크기 배율 `− 90% +`(시안 13, 계획서 P6-11: 50~200%, 10% 단위) */
export function ZoomControls({ zoomPercent, onChange }: ZoomControlsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label={VIEWER_TEXT.ZOOM_OUT}
        disabled={zoomPercent <= RESULT_ZOOM.MIN_PERCENT}
        onClick={() => onChange(zoomPercent - RESULT_ZOOM.STEP_PERCENT)}
        className={ZOOM_BUTTON_CLASS}
      >
        <Minus size={ZOOM_ICON_SIZE} aria-hidden="true" />
      </button>
      <span
        role="status"
        aria-label={VIEWER_TEXT.ZOOM_LEVEL}
        className="min-w-10 text-center font-mono text-xs"
      >
        {viewerText.zoomPercent(zoomPercent)}
      </span>
      <button
        type="button"
        aria-label={VIEWER_TEXT.ZOOM_IN}
        disabled={zoomPercent >= RESULT_ZOOM.MAX_PERCENT}
        onClick={() => onChange(zoomPercent + RESULT_ZOOM.STEP_PERCENT)}
        className={ZOOM_BUTTON_CLASS}
      >
        <Plus size={ZOOM_ICON_SIZE} aria-hidden="true" />
      </button>
    </div>
  );
}
