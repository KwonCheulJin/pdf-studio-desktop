import { useEffect, useState } from "react";
import { COMPARE_SIDES, type Side } from "@/renderer/entities/comparison";

/** 패널(스크롤 컨테이너) 하나가 페이지 영역에 놓인 자리와 보이는 크기(px, 페이지 영역 왼쪽 위 기준) */
export interface PaneBox {
  left: number;
  top: number;
  /** 보이는 콘텐츠 너비·높이(스크롤바 제외, `clientWidth`·`clientHeight`) */
  width: number;
  height: number;
  /** 스크롤바를 포함한 오른쪽 끝(나란히 보기에서 A 패널의 이 값이 거터 왼쪽 끝이다) */
  outerRight: number;
}

/** 보이는 패널마다 자리 */
export type PaneBoxes = Partial<Record<Side, PaneBox>>;

/** 문서 쪽마다 패널 스크롤 컨테이너(마운트 전·보이지 않는 쪽은 `null`) */
export type PaneScrollers = Record<Side, HTMLElement | null>;

interface UsePaneBoxesParams {
  /** 페이지 영역(연결선 오버레이가 덮는 요소) */
  area: HTMLElement | null;
  scrollers: PaneScrollers;
}

function measure(area: HTMLElement, scrollers: PaneScrollers): PaneBoxes {
  const origin = area.getBoundingClientRect();
  return Object.fromEntries(
    COMPARE_SIDES.flatMap((side) => {
      const scroller = scrollers[side];
      if (!scroller) return [];
      const rect = scroller.getBoundingClientRect();
      const box: PaneBox = {
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: scroller.clientWidth,
        height: scroller.clientHeight,
        outerRight: rect.right - origin.left
      };
      return [[side, box]];
    })
  );
}

/**
 * 패널들이 페이지 영역에 놓인 자리를 크기가 바뀔 때마다 잰다(스크롤로는 바뀌지 않는다). 연결선의
 * 끝점 x(쪽의 가로 자리)와 오버레이 좌표 변환에 쓴다. 재기 전에는 `null`이다.
 */
export function usePaneBoxes({
  area,
  scrollers
}: UsePaneBoxesParams): PaneBoxes | null {
  const [boxes, setBoxes] = useState<PaneBoxes | null>(null);
  const { before, after } = scrollers;

  useEffect(() => {
    if (!area) return;
    const current = { before, after };
    let frameId: number | null = null;
    const update = () => {
      frameId = null;
      const next = measure(area, current);
      setBoxes((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next
      );
    };
    // 크기 알림 안에서 배치를 바꾸지 않고 다음 프레임에 잰다(ResizeObserver 알림 고리 방지).
    const observer = new ResizeObserver(() => {
      if (frameId === null) frameId = requestAnimationFrame(update);
    });
    observer.observe(area);
    [before, after].forEach((scroller) => {
      if (scroller) observer.observe(scroller);
    });
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [area, before, after]);

  return boxes;
}
