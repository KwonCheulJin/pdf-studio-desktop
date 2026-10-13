import { useEffect } from "react";
import type { CompareResult } from "@/renderer/entities/comparison";
import type { CompareViewMode } from "@/renderer/features/pdf-compare";
import { VIEWER_LAYOUT, ZOOM } from "../config/viewer-layout";
import { fitScaleOf } from "../lib/row-layout";
import { useViewerStore } from "./viewer-store";

interface UseFitScaleParams {
  /** 너비를 잴 요소: 스크롤 컨테이너(세로 스크롤바를 뺀 너비), 없으면 감싼 요소 */
  element: HTMLElement | null;
  result: CompareResult;
  viewMode: CompareViewMode;
}

/** 페이지 영역 너비가 바뀔 때마다 "맞춤" 배율을 재어 뷰어 스토어에 둔다. */
export function useFitScale({
  element,
  result,
  viewMode
}: UseFitScaleParams): void {
  const setFitScale = useViewerStore((state) => state.setFitScale);

  useEffect(() => {
    if (!element) return;
    let frameId: number | null = null;
    const measure = () => {
      frameId = null;
      const contentWidthPx =
        element.clientWidth - VIEWER_LAYOUT.AREA_PADDING_X_PX * 2;
      const fitScale = fitScaleOf({ result, viewMode, contentWidthPx });
      setFitScale(
        Math.floor(fitScale / ZOOM.FIT_SCALE_STEP) * ZOOM.FIT_SCALE_STEP
      );
    };
    // 크기 알림 안에서 배치를 바꾸지 않고 다음 프레임에 잰다(ResizeObserver 알림 고리 방지).
    const observer = new ResizeObserver(() => {
      if (frameId === null) frameId = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [element, result, viewMode, setFitScale]);
}
