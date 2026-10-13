import { create } from "zustand";
import type { ValueOf } from "@/renderer/shared/types/common";
import { CSS_PX_PER_PT, ZOOM } from "../config/viewer-layout";

export const ZOOM_MODE = {
  /** 가장 넓은 쪽이 칸에 들어가게(창 크기를 따라간다) */
  FIT: "fit",
  /** 고른 배율 그대로 */
  FIXED: "fixed"
} as const;

type ZoomMode = ValueOf<typeof ZOOM_MODE>;

interface ViewerState {
  zoomMode: ZoomMode;
  /** `FIXED`일 때의 배율(%) */
  fixedPercent: number;
  /** 페이지 영역 너비로 잰 "맞춤" 배율(1pt당 CSS px). 재기 전에는 `null` */
  fitScale: number | null;
  /** 페이지 영역 세로 가운데에 걸친 행(현재 쪽 표시)과 그 결과의 작업 ID */
  currentRow: CurrentRow | null;
}

interface CurrentRow {
  jobId: string;
  row: number;
}

interface ViewerActions {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  setFitScale: (fitScale: number) => void;
  setCurrentRow: (currentRow: CurrentRow) => void;
}

type ViewerStore = ViewerState & ViewerActions;

const ZOOM_DIRECTION = { IN: 1, OUT: -1 } as const;

type ZoomDirection = ValueOf<typeof ZOOM_DIRECTION>;

function percentToScale(percent: number): number {
  return (percent / ZOOM.PERCENT_BASE) * CSS_PX_PER_PT;
}

export function scaleToPercent(scale: number): number {
  return Math.round((scale / CSS_PX_PER_PT) * ZOOM.PERCENT_BASE);
}

/** 지금 화면 배율(1pt당 CSS px). 맞춤 배율도 25~300% 안으로 자른다. 아직 재지 않았으면 `null` */
export function scaleOf(state: ViewerState): number | null {
  if (state.zoomMode === ZOOM_MODE.FIXED) {
    return percentToScale(state.fixedPercent);
  }
  if (state.fitScale === null) return null;
  return Math.min(
    percentToScale(ZOOM.MAX_PERCENT),
    Math.max(percentToScale(ZOOM.MIN_PERCENT), state.fitScale)
  );
}

interface NextZoomParams {
  state: ViewerState;
  direction: ZoomDirection;
}

/** 확대·축소 버튼이 갈 다음 배율(%). 끝이면 `null` */
export function nextZoomPercent({
  state,
  direction
}: NextZoomParams): number | null {
  const scale = scaleOf(state);
  if (scale === null) return null;
  const current = scaleToPercent(scale);
  const candidates = ZOOM.PRESETS.filter((preset) =>
    direction === ZOOM_DIRECTION.IN ? preset > current : preset < current
  );
  if (candidates.length === 0) return null;
  return direction === ZOOM_DIRECTION.IN
    ? candidates[0]
    : candidates[candidates.length - 1];
}

function zoomTo({ state, direction }: NextZoomParams): Partial<ViewerState> {
  const next = nextZoomPercent({ state, direction });
  return next === null
    ? state
    : { zoomMode: ZOOM_MODE.FIXED, fixedPercent: next };
}

/** 비교 결과 페이지 영역의 배율·현재 행. 다른 결과를 열어도 배율은 남는다. */
export const useViewerStore = create<ViewerStore>((set) => ({
  zoomMode: ZOOM_MODE.FIT,
  fixedPercent: ZOOM.PERCENT_BASE,
  fitScale: null,
  currentRow: null,
  zoomIn: () => set((state) => zoomTo({ state, direction: ZOOM_DIRECTION.IN })),
  zoomOut: () =>
    set((state) => zoomTo({ state, direction: ZOOM_DIRECTION.OUT })),
  zoomToFit: () => set({ zoomMode: ZOOM_MODE.FIT }),
  setFitScale: (fitScale) =>
    set((state) => (state.fitScale === fitScale ? state : { fitScale })),
  setCurrentRow: (currentRow) =>
    set((state) =>
      state.currentRow?.jobId === currentRow.jobId &&
      state.currentRow.row === currentRow.row
        ? state
        : { currentRow }
    )
}));

export { ZOOM_DIRECTION };

/** 지금 화면 배율. 맞춤을 아직 재지 않았으면 `null` */
export const useViewerScale = () => useViewerStore(scaleOf);

interface CurrentRowParams {
  state: ViewerState;
  jobId: string;
}

/** 그 결과에서 지금 보고 있는 행. 다른 결과의 값이면 첫 행이다. */
export function currentRowOf({ state, jobId }: CurrentRowParams): number {
  return state.currentRow?.jobId === jobId ? state.currentRow.row : 0;
}

export const useCurrentRow = (jobId: string) =>
  useViewerStore((state) => currentRowOf({ state, jobId }));
