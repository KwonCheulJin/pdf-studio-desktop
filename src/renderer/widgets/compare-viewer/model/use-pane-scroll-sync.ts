import { useEffect } from "react";
import type { PaneScrollers } from "./use-pane-boxes";

/**
 * 메아리로 볼 스크롤 차이(px). 맞춘 값을 브라우저가 기기 픽셀로 반올림해도 같은 값으로 본다.
 */
const ECHO_TOLERANCE_PX = 1;

interface ScrollPosition {
  top: number;
  left: number;
}

interface UsePaneScrollSyncParams {
  scrollers: PaneScrollers;
  isSynced: boolean;
}

/**
 * 나란히 보기의 동기 스크롤(계획서 §7.1). 두 패널은 같은 행 배치(행 높이 = 두 쪽 중 큰 쪽)를 쓰므로 한
 * 패널의 스크롤 위치를 다른 패널에 그대로 둔다(세로·가로 모두). 켜는 순간 B를 A에 맞춘다. 맞춰서 생긴
 * 다른 패널의 scroll 이벤트(메아리)는 되돌려 보내지 않는다. 끄면 두 패널이 따로 스크롤한다.
 */
export function usePaneScrollSync({
  scrollers,
  isSynced
}: UsePaneScrollSyncParams): void {
  const { before, after } = scrollers;

  useEffect(() => {
    if (!isSynced || !before || !after) return;
    const expected = new Map<HTMLElement, ScrollPosition>();
    const align = (source: HTMLElement, target: HTMLElement) => {
      const position = { top: source.scrollTop, left: source.scrollLeft };
      if (
        target.scrollTop === position.top &&
        target.scrollLeft === position.left
      ) {
        return;
      }
      expected.set(target, position);
      target.scrollTo(position);
    };
    const follow = (source: HTMLElement, target: HTMLElement) => () => {
      const echo = expected.get(source);
      expected.delete(source);
      const isEcho =
        echo !== undefined &&
        Math.abs(source.scrollTop - echo.top) < ECHO_TOLERANCE_PX &&
        Math.abs(source.scrollLeft - echo.left) < ECHO_TOLERANCE_PX;
      if (!isEcho) align(source, target);
    };
    const followBefore = follow(before, after);
    const followAfter = follow(after, before);
    align(before, after);
    before.addEventListener("scroll", followBefore, { passive: true });
    after.addEventListener("scroll", followAfter, { passive: true });
    return () => {
      before.removeEventListener("scroll", followBefore);
      after.removeEventListener("scroll", followAfter);
    };
  }, [before, after, isSynced]);
}
