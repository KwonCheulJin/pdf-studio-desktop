import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import {
  COMPARE_SIDE,
  highlightsByPage,
  indexPagePairs,
  isChangeVisible,
  numberChanges
} from "@/renderer/entities/comparison";
import {
  COMPARE_VIEW_MODE,
  useActiveChangeId,
  useChangeFilter,
  useCompareViewMode,
  useConnectors,
  useHoveredChangeId,
  useRevealCount,
  type CompletedComparison
} from "@/renderer/features/pdf-compare";
import {
  RENDER_SCALE,
  VIEWER_LAYOUT,
  VIEWER_TEXT
} from "../config/viewer-layout";
import { minimapTicksOf } from "../lib/change-position";
import { panePaddingOf } from "../lib/pane-layout";
import { rowBandsByPage } from "../lib/row-bands";
import {
  layoutRows,
  rowOffsetsOf,
  shownSidesOf,
  type ViewerRow
} from "../lib/row-layout";
import { useChangeReveal } from "../model/use-change-reveal";
import { useConnectorLayout } from "../model/use-connector-layout";
import { useFitScale } from "../model/use-fit-scale";
import { usePaneBoxes, type PaneScrollers } from "../model/use-pane-boxes";
import { usePaneScrollSync } from "../model/use-pane-scroll-sync";
import { useIsScrollSynced, useViewerScale } from "../model/viewer-store";
import { CompareMinimap } from "./compare-minimap";
import { ConnectorOverlay } from "./connector-overlay";
import { PagePane, type ScrollerChange } from "./page-pane";
import { PaneRow } from "./pane-row";

const NO_SCROLLERS: PaneScrollers = {
  [COMPARE_SIDE.BEFORE]: null,
  [COMPARE_SIDE.AFTER]: null
};

/** 화면 배율 × 기기 픽셀 비율을 단위로 올린 렌더 배율(같은 단위 안의 창 크기 변화는 캐시를 쓴다) */
function renderScaleOf(scale: number): number {
  const stepped =
    Math.ceil((scale * window.devicePixelRatio) / RENDER_SCALE.STEP) *
    RENDER_SCALE.STEP;
  return Math.min(RENDER_SCALE.MAX, Math.max(RENDER_SCALE.MIN, stepped));
}

interface CompareViewerProps {
  completed: CompletedComparison;
}

/**
 * 결과 화면 가운데 페이지 영역(계획서 P3-4·§7.1) + 오른쪽 미니맵. 나란히 보기는 A·B 두 패널이 따로
 * 스크롤하고(동기 스크롤을 켜면 함께), 그 사이 거터를 연결선이 건넌다. 패널마다 virtuoso가 행 단위로
 * 가상화해 화면 근처 행만 pdf.js로 그린다. 두 패널은 같은 행 배치(`page_pairs` 한 쌍 = 한 행)를 쓰고, 행
 * 크기는 `page_sizes`로 미리 안다. 연결선은 비교 영역 전체를 덮는 SVG 한 장(`ConnectorOverlay`)이다.
 */
export function CompareViewer({ completed }: CompareViewerProps) {
  const { jobId, result, files } = completed;
  const filter = useChangeFilter();
  const activeChangeId = useActiveChangeId();
  const revealCount = useRevealCount();
  const viewMode = useCompareViewMode();
  const connectors = useConnectors();
  const hoveredChangeId = useHoveredChangeId();
  const isScrollSynced = useIsScrollSynced();
  const scale = useViewerScale();
  const beforeHandle = useRef<VirtuosoHandle>(null);
  const afterHandle = useRef<VirtuosoHandle>(null);
  const [area, setArea] = useState<HTMLElement | null>(null);
  const [mountedScrollers, setMountedScrollers] =
    useState<PaneScrollers>(NO_SCROLLERS);

  const shownSides = shownSidesOf(viewMode);
  const isSplit = shownSides.length > 1;
  const scrollers = useMemo(
    (): PaneScrollers => ({
      [COMPARE_SIDE.BEFORE]: shownSides.includes(COMPARE_SIDE.BEFORE)
        ? mountedScrollers.before
        : null,
      [COMPARE_SIDE.AFTER]: shownSides.includes(COMPARE_SIDE.AFTER)
        ? mountedScrollers.after
        : null
    }),
    [shownSides, mountedScrollers]
  );
  const handleScroller = useCallback(
    ({ side, scroller, removed }: ScrollerChange) =>
      setMountedScrollers((previous) => {
        // 새 패널이 먼저 왔으면 옛 패널의 정리(`null`)는 무시한다.
        const isStale = scroller === null && previous[side] !== removed;
        return isStale || previous[side] === scroller
          ? previous
          : { ...previous, [side]: scroller };
      }),
    []
  );
  const handles = useMemo(
    () => ({
      [COMPARE_SIDE.BEFORE]: beforeHandle,
      [COMPARE_SIDE.AFTER]: afterHandle
    }),
    []
  );

  useFitScale({
    area,
    pane: scrollers[shownSides[0]],
    result,
    viewMode
  });

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
  // 연결선 끝의 줄 표시는 쪽 위에 그린다(연결선을 끄거나 패널이 하나면 없다).
  const rowBands = useMemo(
    () => ({
      [COMPARE_SIDE.BEFORE]: rowBandsByPage({
        connectors: isSplit ? connectors : null,
        side: COMPARE_SIDE.BEFORE
      }),
      [COMPARE_SIDE.AFTER]: rowBandsByPage({
        connectors: isSplit ? connectors : null,
        side: COMPARE_SIDE.AFTER
      })
    }),
    [connectors, isSplit]
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
  const paneBoxes = usePaneBoxes({ area, scrollers });
  usePaneScrollSync({ scrollers, isSynced: isScrollSynced && isSplit });
  useChangeReveal({
    handles,
    scrollers,
    rows,
    offsets,
    rowLookup,
    completed,
    activeChangeId,
    revealCount,
    viewMode,
    isScrollSynced
  });
  const connectorLayout = useConnectorLayout({
    connectors: isSplit ? connectors : null,
    result,
    files,
    rows,
    offsets,
    rowLookup,
    paneBoxes
  });

  const renderScale = scale === null ? RENDER_SCALE.MIN : renderScaleOf(scale);
  const renderRows = useMemo(
    () =>
      Object.fromEntries(
        shownSides.map((side) => {
          const padding = panePaddingOf({ side, isSplit });
          const renderRow = (_index: number, row: ViewerRow) => (
            <PaneRow
              row={row}
              side={side}
              padding={padding}
              file={files[side]}
              pageSources={result.pageSources}
              highlights={highlights[side]}
              rowBands={rowBands[side]}
              activeChangeId={activeChangeId}
              hoveredChangeId={hoveredChangeId}
              renderScale={renderScale}
            />
          );
          return [side, renderRow];
        })
      ),
    [
      shownSides,
      isSplit,
      files,
      result.pageSources,
      highlights,
      rowBands,
      activeChangeId,
      hoveredChangeId,
      renderScale
    ]
  );
  const referenceSide =
    viewMode === COMPARE_VIEW_MODE.BEFORE_ONLY
      ? COMPARE_SIDE.BEFORE
      : COMPARE_SIDE.AFTER;

  return (
    <div className="bg-canvas flex min-h-0 min-w-0 flex-1">
      <section
        ref={setArea}
        aria-label={VIEWER_TEXT.PAGE_AREA}
        className="relative flex min-w-0 flex-1"
      >
        {rows.length > 0 &&
          shownSides.map((side, index) => (
            <Fragment key={side}>
              {index > 0 && (
                <div
                  aria-hidden="true"
                  data-connector-gutter=""
                  className="shrink-0"
                  style={{ width: VIEWER_LAYOUT.GUTTER_PX }}
                />
              )}
              <PagePane
                key={`${viewMode}:${scale}`}
                side={side}
                jobId={jobId}
                rows={rows}
                virtuosoRef={handles[side]}
                onScroller={handleScroller}
                renderRow={renderRows[side]}
                hideScrollbar={isSplit && side === COMPARE_SIDE.BEFORE}
              />
            </Fragment>
          ))}
        {connectorLayout && (
          <ConnectorOverlay
            layout={connectorLayout}
            scrollers={scrollers}
            paneBoxes={paneBoxes}
            activeChangeId={activeChangeId}
          />
        )}
      </section>
      <CompareMinimap
        ticks={ticks}
        scroller={scrollers[referenceSide]}
        offsets={offsets}
        jobId={jobId}
      />
    </div>
  );
}
