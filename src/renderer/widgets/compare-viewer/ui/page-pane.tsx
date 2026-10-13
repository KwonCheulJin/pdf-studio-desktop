import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import {
  Virtuoso,
  type ScrollSeekConfiguration,
  type ScrollSeekPlaceholderProps,
  type VirtuosoHandle
} from "react-virtuoso";
import { COMPARE_SIDE_BADGE, type Side } from "@/renderer/entities/comparison";
import {
  paneLabel,
  SCROLL_SEEK_VELOCITY,
  VIEWER_LAYOUT
} from "../config/viewer-layout";
import type { ViewerRow } from "../lib/row-layout";
import { currentRowOf, useViewerStore } from "../model/viewer-store";

/** 빠르게 스크롤하는 동안은 쪽을 그리지 않는다(지나가는 행을 렌더하지 않는다). */
const SCROLL_SEEK: ScrollSeekConfiguration = {
  enter: (velocity) => Math.abs(velocity) > SCROLL_SEEK_VELOCITY.ENTER,
  exit: (velocity) => Math.abs(velocity) < SCROLL_SEEK_VELOCITY.EXIT
};

function RowSeekPlaceholder({ height }: ScrollSeekPlaceholderProps) {
  return <div aria-hidden="true" style={{ height }} />;
}

const VIRTUOSO_COMPONENTS = { ScrollSeekPlaceholder: RowSeekPlaceholder };

/**
 * 세로 스크롤바 자리를 늘 비워 둔다. 그러지 않으면 스크롤바가 생기고 없어질 때마다 너비가 바뀌어
 * "맞춤" 배율이 오락가락할 수 있다(배율 → 높이 → 스크롤바 → 너비 → 배율).
 */
const SCROLLER_STYLE = { height: "100%", scrollbarGutter: "stable" } as const;

/** 패널 스크롤 컨테이너의 변화. 배율을 바꿔 패널을 새로 만들 때 새 요소가 옛 요소의 정리보다 먼저 올 수 있어 사라진 요소를 함께 알린다. */
export interface ScrollerChange {
  side: Side;
  scroller: HTMLElement | null;
  removed: HTMLElement | null;
}

interface PagePaneProps {
  side: Side;
  /** 보고 있는 결과. 처음 맨 위에 둘 행(배율·보기 방식을 바꾸기 전에 보던 행)을 찾는다. */
  jobId: string;
  rows: readonly ViewerRow[];
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  /** 스크롤 컨테이너가 생기면 그 요소, 사라지면 `null`과 사라진 요소를 알린다. */
  onScroller: (change: ScrollerChange) => void;
  renderRow: (index: number, row: ViewerRow) => ReactNode;
}

/**
 * 문서 하나의 패널(계획서 §7.1): 그 문서 쪽을 행 단위로 가상화한 스크롤 컨테이너. 행은 두 패널이 같은
 * 배치(`page_pairs` 한 쌍 = 한 행, 높이 같음)라 동기 스크롤은 위치를 그대로 맞춘다. 배율·보기 방식이
 * 바뀌면 행 높이가 모두 바뀌므로 바깥에서 새로 만든다(`key`).
 */
export function PagePane({
  side,
  jobId,
  rows,
  virtuosoRef,
  onScroller,
  renderRow
}: PagePaneProps) {
  const [initialIndex] = useState(() =>
    Math.min(
      rows.length - 1,
      currentRowOf({ state: useViewerStore.getState(), jobId })
    )
  );
  const heightEstimates = useMemo(
    () => rows.map(({ heightPx }) => heightPx),
    [rows]
  );
  const mountedScroller = useRef<HTMLElement | null>(null);
  const handleScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      const scroller = element instanceof HTMLElement ? element : null;
      const removed = scroller ? null : mountedScroller.current;
      mountedScroller.current = scroller;
      onScroller({ side, scroller, removed });
    },
    [onScroller, side]
  );
  return (
    <div
      role="group"
      aria-label={paneLabel(COMPARE_SIDE_BADGE[side])}
      className="min-w-0 flex-1"
    >
      <Virtuoso
        ref={virtuosoRef}
        data={rows}
        computeItemKey={(_index, row) => row.key}
        heightEstimates={heightEstimates}
        initialTopMostItemIndex={initialIndex}
        increaseViewportBy={VIEWER_LAYOUT.OVERSCAN_PX}
        scrollSeekConfiguration={SCROLL_SEEK}
        scrollerRef={handleScrollerRef}
        components={VIRTUOSO_COMPONENTS}
        itemContent={renderRow}
        style={SCROLLER_STYLE}
      />
    </div>
  );
}
