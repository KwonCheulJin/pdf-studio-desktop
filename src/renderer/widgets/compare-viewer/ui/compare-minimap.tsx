import { CHANGE_KIND_STYLE } from "@/renderer/entities/comparison";
import { cn } from "@/renderer/shared/lib/utils";
import { VIEWER_TEXT } from "../config/viewer-layout";
import type { MinimapTick } from "../lib/change-position";
import { useViewerScroll } from "../model/use-viewer-scroll";

interface CompareMinimapProps {
  ticks: readonly MinimapTick[];
  /** 기준 패널(현재 쪽 문서의 패널)의 스크롤 컨테이너 */
  scroller: HTMLElement | null;
  offsets: readonly number[];
  jobId: string;
}

/**
 * 오른쪽 미니맵(시안 4: 너비 34px + 왼쪽 테두리, 그려진 35px): 보이는 변경의 위치 눈금(종류 색)과
 * 기준 패널에 지금 보이는 화면 틀. 페이지 영역 전체 높이에 대한 비율로 놓는다. 스크롤마다 바뀌는 틀은
 * 이 컴포넌트만 다시 그린다.
 */
export function CompareMinimap({
  ticks,
  scroller,
  offsets,
  jobId
}: CompareMinimapProps) {
  const frame = useViewerScroll({ scroller, offsets, jobId });
  return (
    <div
      role="img"
      aria-label={VIEWER_TEXT.MINIMAP}
      className="bg-card border-border relative w-8.75 shrink-0 border-l"
    >
      {ticks.map((tick) => (
        <span
          key={tick.changeId}
          data-change-id={tick.changeId}
          className={cn(
            "absolute inset-x-2 h-0.75",
            CHANGE_KIND_STYLE[tick.kind].solid
          )}
          style={{ top: `${tick.topPercent}%` }}
        />
      ))}
      {frame && (
        <span
          data-minimap-frame=""
          className="border-primary absolute inset-x-1 rounded-xs border-2"
          style={{
            top: `${frame.topPercent}%`,
            height: `${frame.heightPercent}%`
          }}
        />
      )}
    </div>
  );
}
