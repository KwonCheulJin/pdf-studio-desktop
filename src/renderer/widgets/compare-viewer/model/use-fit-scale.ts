import { useEffect } from "react";
import type { CompareResult } from "@/renderer/entities/comparison";
import type { CompareViewMode } from "@/renderer/features/pdf-compare";
import { VIEWER_LAYOUT, ZOOM } from "../config/viewer-layout";
import { fitScaleOf, shownSidesOf } from "../lib/row-layout";
import { useViewerStore } from "./viewer-store";

interface UseFitScaleParams {
  /** 페이지 영역(패널들과 거터를 담는다) */
  area: HTMLElement | null;
  /** 첫 패널의 스크롤 컨테이너. 있으면 그 안쪽 너비(세로 스크롤바 제외)로 잰다. */
  pane: HTMLElement | null;
  result: CompareResult;
  viewMode: CompareViewMode;
}

interface ColumnWidthParams {
  area: HTMLElement;
  pane: HTMLElement | null;
  sideCount: number;
}

/**
 * 쪽 하나가 놓이는 칸 너비. 패널 안쪽 너비에서 페이지 영역 바깥 여백을 뺀다(나란히는 바깥쪽 한 변, 한쪽만
 * 보기는 두 변). 패널이 아직 없으면 페이지 영역에서 거터를 빼고 나눈 너비로 어림한다.
 */
function columnWidthOf({ area, pane, sideCount }: ColumnWidthParams): number {
  const isSplit = sideCount > 1;
  const paddingPx = VIEWER_LAYOUT.AREA_PADDING_X_PX * (isSplit ? 1 : 2);
  const paneWidthPx = pane
    ? pane.clientWidth
    : (area.clientWidth - (isSplit ? VIEWER_LAYOUT.GUTTER_PX : 0)) / sideCount;
  return paneWidthPx - paddingPx;
}

/** 페이지 영역 너비가 바뀔 때마다 "맞춤" 배율을 재어 뷰어 스토어에 둔다. */
export function useFitScale({
  area,
  pane,
  result,
  viewMode
}: UseFitScaleParams): void {
  const setFitScale = useViewerStore((state) => state.setFitScale);

  useEffect(() => {
    if (!area) return;
    let frameId: number | null = null;
    const sideCount = shownSidesOf(viewMode).length;
    const measure = () => {
      frameId = null;
      const columnWidthPx = columnWidthOf({ area, pane, sideCount });
      const fitScale = fitScaleOf({ result, viewMode, columnWidthPx });
      setFitScale(
        Math.floor(fitScale / ZOOM.FIT_SCALE_STEP) * ZOOM.FIT_SCALE_STEP
      );
    };
    // 크기 알림 안에서 배치를 바꾸지 않고 다음 프레임에 잰다(ResizeObserver 알림 고리 방지).
    const observer = new ResizeObserver(() => {
      if (frameId === null) frameId = requestAnimationFrame(measure);
    });
    observer.observe(pane ?? area);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [area, pane, result, viewMode, setFitScale]);
}
