import { useEffect, useState } from "react";
import { SCROLL_IDLE_MS, SCROLLING_ATTRIBUTE } from "../config/viewer-layout";
import { useViewerStore } from "./viewer-store";

const PERCENT = 100;
const HALF = 2;

/** 미니맵의 현재 화면 틀(전체 높이에 대한 %) */
export interface ScrollFrame {
  topPercent: number;
  heightPercent: number;
}

interface RowAtParams {
  offsets: readonly number[];
  top: number;
}

/** `top`이 걸친 행(`offsets`는 행 위 끝, 마지막 값은 전체 높이) */
function rowAt({ offsets, top }: RowAtParams): number {
  const lastRow = offsets.length - 2;
  let low = 0;
  let high = Math.max(0, lastRow);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= top) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

interface UseViewerScrollParams {
  scroller: HTMLElement | null;
  offsets: readonly number[];
  /** 보고 있는 결과(현재 행을 결과마다 따로 둔다) */
  jobId: string;
}

/**
 * 페이지 영역 스크롤을 프레임당 한 번만 읽어 미니맵 틀을 돌려주고, 화면 세로 가운데에 걸친 행을
 * 뷰어 스토어(현재 쪽 표시)에 둔다. 스크롤 컨테이너의 크기 변화도 같이 본다.
 *
 * 스크롤하는 동안은 컨테이너에 `data-scrolling`을 달고 마지막 스크롤 이벤트 뒤
 * [`SCROLL_IDLE_MS`]가 지나면 지운다. 연결선은 CSS로 이 속성을 보고 숨는다(계획서 §7.1). 속성은
 * DOM에 바로 달아 React가 다시 그리지 않는다.
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
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      idleTimer = null;
      scroller.removeAttribute(SCROLLING_ATTRIBUTE);
    };
    // 전체 높이는 행 배치로 이미 안다(virtuoso가 아직 재지 않은 행도 같은 높이로 그린다).
    const totalHeight = offsets[offsets.length - 1] ?? 0;
    const update = () => {
      frameId = null;
      if (idleTimer !== null && !scroller.hasAttribute(SCROLLING_ATTRIBUTE)) {
        scroller.setAttribute(SCROLLING_ATTRIBUTE, "");
      }
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
    const handleScroll = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(settle, SCROLL_IDLE_MS);
      schedule();
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (idleTimer !== null) clearTimeout(idleTimer);
      scroller.removeAttribute(SCROLLING_ATTRIBUTE);
      scroller.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [scroller, offsets, jobId, setCurrentRow]);

  return frame;
}
