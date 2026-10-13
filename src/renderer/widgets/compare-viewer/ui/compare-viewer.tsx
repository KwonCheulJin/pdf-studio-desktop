import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import {
  Virtuoso,
  type ScrollSeekConfiguration,
  type ScrollSeekPlaceholderProps,
  type VirtuosoHandle
} from "react-virtuoso";
import {
  COMPARE_SIDE,
  highlightsByPage,
  indexPagePairs,
  isChangeVisible,
  numberChanges
} from "@/renderer/entities/comparison";
import {
  useActiveChangeId,
  useChangeFilter,
  useCompareViewMode,
  useConnectorStems,
  useHoveredChangeIds,
  useRevealCount,
  type CompletedComparison
} from "@/renderer/features/pdf-compare";
import {
  RENDER_SCALE,
  SCROLL_SEEK_VELOCITY,
  VIEWER_LAYOUT,
  VIEWER_TEXT
} from "../config/viewer-layout";
import { minimapTicksOf } from "../lib/change-position";
import { layoutRows, rowOffsetsOf, type ViewerRow } from "../lib/row-layout";
import { useChangeReveal } from "../model/use-change-reveal";
import { useFitScale } from "../model/use-fit-scale";
import { useViewerScroll } from "../model/use-viewer-scroll";
import {
  currentRowOf,
  useViewerScale,
  useViewerStore
} from "../model/viewer-store";
import { CompareMinimap } from "./compare-minimap";
import { PageRow } from "./page-row";

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

/** 화면 배율 × 기기 픽셀 비율을 단위로 올린 렌더 배율(같은 단위 안의 창 크기 변화는 캐시를 쓴다) */
function renderScaleOf(scale: number): number {
  const stepped =
    Math.ceil((scale * window.devicePixelRatio) / RENDER_SCALE.STEP) *
    RENDER_SCALE.STEP;
  return Math.min(RENDER_SCALE.MAX, Math.max(RENDER_SCALE.MIN, stepped));
}

interface RowScrollerProps {
  jobId: string;
  rows: readonly ViewerRow[];
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  onScroller: (scroller: HTMLElement | null) => void;
  renderRow: (index: number, row: ViewerRow) => React.ReactNode;
}

/**
 * 행 가상화 스크롤 컨테이너. 배율·보기 방식이 바뀌면 행 높이가 모두 바뀌므로 새로 만들고
 * (`key`), 그때 보던 행에서 시작한다.
 */
function RowScroller({
  jobId,
  rows,
  virtuosoRef,
  onScroller,
  renderRow
}: RowScrollerProps) {
  const [initialRow] = useState(() =>
    Math.min(
      rows.length - 1,
      currentRowOf({ state: useViewerStore.getState(), jobId })
    )
  );
  const heightEstimates = useMemo(
    () => rows.map(({ heightPx }) => heightPx),
    [rows]
  );
  const handleScrollerRef = useCallback(
    (element: HTMLElement | Window | null) =>
      onScroller(element instanceof HTMLElement ? element : null),
    [onScroller]
  );
  return (
    <Virtuoso
      ref={virtuosoRef}
      data={rows}
      computeItemKey={(_index, row) => row.key}
      heightEstimates={heightEstimates}
      initialTopMostItemIndex={initialRow}
      increaseViewportBy={VIEWER_LAYOUT.OVERSCAN_PX}
      scrollSeekConfiguration={SCROLL_SEEK}
      scrollerRef={handleScrollerRef}
      components={VIRTUOSO_COMPONENTS}
      itemContent={renderRow}
      style={SCROLLER_STYLE}
    />
  );
}

interface CompareViewerProps {
  completed: CompletedComparison;
}

/**
 * 결과 화면 가운데 페이지 영역(계획서 P3-4) + 오른쪽 미니맵. 스크롤 컨테이너는 하나이고
 * `page_pairs`의 한 쌍이 한 행이며, virtuoso가 행 단위로 가상화해 화면 근처 행만 pdf.js로 그린다.
 * 좌우가 따로 스크롤하지 않으므로 동기 스크롤이 없다. 행 크기는 `page_sizes`로 미리 안다.
 * 연결선 묶음은 행마다 pt로 한 번 계산하고(배율과 상관없다), 마운트된 행만 거터에 그린다.
 */
export function CompareViewer({ completed }: CompareViewerProps) {
  const { jobId, result, files } = completed;
  const filter = useChangeFilter();
  const activeChangeId = useActiveChangeId();
  const revealCount = useRevealCount();
  const viewMode = useCompareViewMode();
  const connectorStems = useConnectorStems();
  const hoveredChangeIds = useHoveredChangeIds();
  const scale = useViewerScale();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [wrapper, setWrapper] = useState<HTMLElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

  useFitScale({ element: scroller ?? wrapper, result, viewMode });

  const rowLookup = useMemo(
    () => indexPagePairs(result.pagePairs),
    [result.pagePairs]
  );
  const visibleChanges = useMemo(
    () =>
      numberChanges(result.changes).filter(({ change }) =>
        isChangeVisible({ change, filter })
      ),
    [result.changes, filter]
  );
  const highlights = useMemo(
    () => ({
      [COMPARE_SIDE.BEFORE]: highlightsByPage({
        changes: visibleChanges,
        side: COMPARE_SIDE.BEFORE
      }),
      [COMPARE_SIDE.AFTER]: highlightsByPage({
        changes: visibleChanges,
        side: COMPARE_SIDE.AFTER
      })
    }),
    [visibleChanges]
  );
  const rows = useMemo(
    () => (scale === null ? [] : layoutRows({ result, scale, viewMode })),
    [result, scale, viewMode]
  );
  const offsets = useMemo(() => rowOffsetsOf(rows), [rows]);
  const ticks = useMemo(
    () => minimapTicksOf({ changes: visibleChanges, rowLookup, rows, offsets }),
    [visibleChanges, rowLookup, rows, offsets]
  );
  const frame = useViewerScroll({ scroller, offsets, jobId });

  useChangeReveal({
    virtuosoRef,
    scroller,
    rows,
    rowLookup,
    completed,
    activeChangeId,
    revealCount,
    viewMode
  });

  const renderScale = scale === null ? RENDER_SCALE.MIN : renderScaleOf(scale);
  const renderRow = useCallback(
    (index: number, row: ViewerRow) => (
      <PageRow
        row={row}
        files={files}
        pageSources={result.pageSources}
        highlights={highlights}
        stems={connectorStems?.[index] ?? null}
        activeChangeId={activeChangeId}
        hoveredChangeIds={hoveredChangeIds}
        renderScale={renderScale}
      />
    ),
    [
      files,
      result.pageSources,
      highlights,
      connectorStems,
      activeChangeId,
      hoveredChangeIds,
      renderScale
    ]
  );

  return (
    <div className="bg-canvas flex min-h-0 min-w-0 flex-1">
      <section
        ref={setWrapper}
        aria-label={VIEWER_TEXT.PAGE_AREA}
        className="min-w-0 flex-1"
      >
        {rows.length > 0 && (
          <RowScroller
            key={`${viewMode}:${scale}`}
            jobId={jobId}
            rows={rows}
            virtuosoRef={virtuosoRef}
            onScroller={setScroller}
            renderRow={renderRow}
          />
        )}
      </section>
      <CompareMinimap ticks={ticks} frame={frame} />
    </div>
  );
}
