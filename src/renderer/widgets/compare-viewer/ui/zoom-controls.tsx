import { Minus, Plus } from "lucide-react";
import { cn } from "@/renderer/shared/lib/utils";
import { VIEWER_TEXT } from "../config/viewer-layout";
import {
  nextZoomPercent,
  scaleOf,
  scaleToPercent,
  useViewerStore,
  ZOOM_DIRECTION,
  ZOOM_MODE
} from "../model/viewer-store";

const ZOOM_ICON_SIZE = 14;

const ZOOM_BUTTON_CLASS =
  "hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-7 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

/** 확대·축소·맞춤과 지금 배율(시안 4). 100% = 1pt가 96/72 CSS px(pdf.js 뷰어와 같다) */
export function ZoomControls() {
  const percent = useViewerStore((state) => {
    const scale = scaleOf(state);
    return scale === null ? null : scaleToPercent(scale);
  });
  const canZoomIn = useViewerStore(
    (state) => nextZoomPercent({ state, direction: ZOOM_DIRECTION.IN }) !== null
  );
  const canZoomOut = useViewerStore(
    (state) =>
      nextZoomPercent({ state, direction: ZOOM_DIRECTION.OUT }) !== null
  );
  const isFit = useViewerStore((state) => state.zoomMode === ZOOM_MODE.FIT);
  const zoomIn = useViewerStore((state) => state.zoomIn);
  const zoomOut = useViewerStore((state) => state.zoomOut);
  const zoomToFit = useViewerStore((state) => state.zoomToFit);

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label={VIEWER_TEXT.ZOOM_OUT}
        disabled={!canZoomOut}
        onClick={zoomOut}
        className={cn(ZOOM_BUTTON_CLASS, "w-7")}
      >
        <Minus size={ZOOM_ICON_SIZE} aria-hidden="true" />
      </button>
      <span
        role="status"
        aria-label={VIEWER_TEXT.ZOOM_LEVEL}
        className="min-w-10 text-center font-mono text-xs"
      >
        {percent === null ? "" : `${percent}%`}
      </span>
      <button
        type="button"
        aria-label={VIEWER_TEXT.ZOOM_IN}
        disabled={!canZoomIn}
        onClick={zoomIn}
        className={cn(ZOOM_BUTTON_CLASS, "w-7")}
      >
        <Plus size={ZOOM_ICON_SIZE} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-pressed={isFit}
        onClick={zoomToFit}
        className={cn(ZOOM_BUTTON_CLASS, "px-2 text-xs")}
      >
        {VIEWER_TEXT.ZOOM_FIT}
      </button>
    </div>
  );
}
