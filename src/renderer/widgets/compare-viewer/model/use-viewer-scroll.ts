import { useEffect, useState } from "react";
import { rowAt } from "../lib/row-layout";
import { useViewerStore } from "./viewer-store";

const PERCENT = 100;
const HALF = 2;

/** 미니맵의 현재 화면 틀(전체 높이에 대한 %) */
export interface ScrollFrame {
  topPercent: number;
  heightPercent: number;
}

interface UseViewerScrollParams {
  /** 기준 패널(현재 쪽 문서의 패널: 나란히·B만은 B, A만은 A)의 스크롤 컨테이너 */
  scroller: HTMLElement | null;
  offsets: readonly number[];
  /** 보고 있는 결과(현재 행을 결과마다 따로 둔다) */
  jobId: string;
}

/**
 * 기준 패널 스크롤을 프레임당 한 번만 읽어 미니맵 틀을 돌려주고, 화면 세로 가운데에 걸친 행을 뷰어
 * 스토어(현재 쪽 표시, 배율을 바꾼 뒤 다시 시작할 행)에 둔다. 스크롤 컨테이너의 크기 변화도 같이 본다.
 * 두 패널은 행 배치가 같아 틀과 행은 어느 패널로 재도 같은 규칙이다.
 */
export function useViewerScroll({
  scroller,
  offsets,
  jobId
}: UseViewerScrollParams): ScrollFrame | null {
  const [frame, setFrame] = useState<ScrollFrame | null>(null);
  const setCurrentRow = useViewerStore((state) => state.setCurrentRow);

  useEffect(() => {
    if (!scroller) return;
    let frameId: number | null = null;
    // 전체 높이는 행 배치로 이미 안다(virtuoso가 아직 재지 않은 행도 같은 높이로 그린다).
    const totalHeight = offsets[offsets.length - 1] ?? 0;
    const update = () => {
      frameId = null;
      const { scrollTop, clientHeight } = scroller;
      if (totalHeight > 0) {
        setFrame({
          topPercent: (scrollTop / totalHeight) * PERCENT,
          heightPercent: Math.min(
            PERCENT,
            (clientHeight / totalHeight) * PERCENT
          )
        });
      }
      setCurrentRow({
        jobId,
        row: rowAt({ offsets, top: scrollTop + clientHeight / HALF })
      });
    };
    const schedule = () => {
      if (frameId === null) {
        frameId = requestAnimationFrame(update);
      }
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      scroller.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [scroller, offsets, jobId, setCurrentRow]);

  return frame;
}
