import { useMemo } from "react";
import {
  COMPARE_SIDE,
  COMPARE_SIDES,
  connectorEndOf,
  type CompareResult,
  type Connector,
  type RowLookup,
  type Side
} from "@/renderer/entities/comparison";
import type { CompareFile } from "@/renderer/features/pdf-compare";
import {
  usePageGeometries,
  type PageGeometry
} from "@/renderer/shared/lib/pdfjs";
import { VIEWER_LAYOUT } from "../config/viewer-layout";
import {
  endIndexOf,
  endSpanOf,
  toContentRect,
  type ConnectorLayoutItem,
  type EndIndex
} from "../lib/connector-geometry";
import { pageLeftOf, panePaddingOf } from "../lib/pane-layout";
import type { ViewerRow } from "../lib/row-layout";
import type { PaneBoxes } from "./use-pane-boxes";

const NO_PAGES: readonly number[] = [];

/** 연결선들의 콘텐츠 좌표와 패널마다의 컬링 색인 */
export interface ConnectorLayout {
  items: ConnectorLayoutItem[];
  index: Record<Side, EndIndex>;
}

interface UseConnectorLayoutParams {
  /** 그릴 연결선(꺼져 있으면 `null`) */
  connectors: readonly Connector[] | null;
  result: CompareResult;
  files: Record<Side, CompareFile>;
  rows: readonly ViewerRow[];
  /** `rowOffsetsOf(rows)` */
  offsets: readonly number[];
  rowLookup: RowLookup;
  paneBoxes: PaneBoxes | null;
}

/** 결과의 변경 끝이 놓이는 쪽(쪽 크기가 있는 쪽만). 필터와 상관없어 결과마다 한 번 받는다. */
function endPagesOf(result: CompareResult, side: Side): number[] {
  const pages = result.changes.flatMap((change) => {
    const end = connectorEndOf(
      side === COMPARE_SIDE.BEFORE ? change.before : change.after
    );
    return end && result.pageSizes[side][end.bounds.page]
      ? [end.bounds.page]
      : [];
  });
  return [...new Set(pages)].sort((first, second) => first - second);
}

interface PlaceEndParams {
  connector: Connector;
  side: Side;
  geometries: ReadonlyMap<number, PageGeometry>;
  rows: readonly ViewerRow[];
  offsets: readonly number[];
  rowLookup: RowLookup;
  paneWidthPx: number;
}

/** 끝 하나를 그 패널 콘텐츠 좌표로(계획서 §7.1 좌표 변환 앞 두 단계). 쪽을 아직 모르면 `null` */
function placeEnd({
  connector,
  side,
  geometries,
  rows,
  offsets,
  rowLookup,
  paneWidthPx
}: PlaceEndParams) {
  const end = connector[side];
  const geometry = geometries.get(end.bounds.page);
  const row = rowLookup[side].get(end.bounds.page);
  const slot =
    row === undefined
      ? undefined
      : rows[row]?.slots.find((candidate) => candidate.side === side);
  if (!geometry || row === undefined || !slot) return null;
  const rect = toContentRect({
    geometry,
    bounds: end.bounds,
    page: {
      left: pageLeftOf({
        paneWidthPx,
        slotWidthPx: slot.widthPx,
        padding: panePaddingOf({ side, isSplit: true })
      }),
      top: offsets[row] + VIEWER_LAYOUT.CAPTION_HEIGHT_PX,
      widthPx: slot.widthPx,
      heightPx: slot.heightPx
    }
  });
  return endSpanOf({ rect, end, side });
}

/**
 * 연결선마다 두 끝의 패널 콘텐츠 좌표(끝점 x, 띠 변 위·아래)를 결과·배율·패널 너비가 바뀔 때만
 * 계산한다(계획서 §7.1 "쪽 기준 좌표는 캐시"). 끝이 놓인 쪽의 pdf.js 화면 변환은 화면에 놓이지 않은
 * 쪽도 미리 받는다(한쪽 끝이 화면 밖인 선을 경계로 끌어오려면 그 끝의 자리를 알아야 한다).
 */
export function useConnectorLayout({
  connectors,
  result,
  files,
  rows,
  offsets,
  rowLookup,
  paneBoxes
}: UseConnectorLayoutParams): ConnectorLayout | null {
  const endPages = useMemo(
    () => ({
      [COMPARE_SIDE.BEFORE]: endPagesOf(result, COMPARE_SIDE.BEFORE),
      [COMPARE_SIDE.AFTER]: endPagesOf(result, COMPARE_SIDE.AFTER)
    }),
    [result]
  );
  const isDrawn = connectors !== null;
  const beforeGeometries = usePageGeometries({
    path: files.before.path,
    pages: isDrawn ? endPages.before : NO_PAGES
  });
  const afterGeometries = usePageGeometries({
    path: files.after.path,
    pages: isDrawn ? endPages.after : NO_PAGES
  });

  return useMemo(() => {
    const before = paneBoxes?.before;
    const after = paneBoxes?.after;
    if (!connectors || !beforeGeometries || !afterGeometries) return null;
    if (!before || !after) return null;
    const geometries = {
      [COMPARE_SIDE.BEFORE]: beforeGeometries,
      [COMPARE_SIDE.AFTER]: afterGeometries
    };
    const paneWidths = {
      [COMPARE_SIDE.BEFORE]: before.width,
      [COMPARE_SIDE.AFTER]: after.width
    };
    const items = connectors.flatMap((connector): ConnectorLayoutItem[] => {
      const [beforeEnd, afterEnd] = COMPARE_SIDES.map((side) =>
        placeEnd({
          connector,
          side,
          geometries: geometries[side],
          rows,
          offsets,
          rowLookup,
          paneWidthPx: paneWidths[side]
        })
      );
      if (!beforeEnd || !afterEnd) return [];
      return [
        {
          changeId: connector.change.id,
          kind: connector.change.kind,
          shape: connector.shape,
          ends: { before: beforeEnd, after: afterEnd }
        }
      ];
    });
    return {
      items,
      index: {
        [COMPARE_SIDE.BEFORE]: endIndexOf({ items, side: COMPARE_SIDE.BEFORE }),
        [COMPARE_SIDE.AFTER]: endIndexOf({ items, side: COMPARE_SIDE.AFTER })
      }
    };
  }, [
    connectors,
    beforeGeometries,
    afterGeometries,
    paneBoxes,
    rows,
    offsets,
    rowLookup
  ]);
}
