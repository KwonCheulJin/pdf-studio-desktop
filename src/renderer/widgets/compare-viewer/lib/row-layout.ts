import {
  COMPARE_SIDE,
  COMPARE_SIDES,
  pageOfPair,
  type PagePair,
  type PageSize,
  type Side
} from "@/renderer/entities/comparison";
import type { CompareResult } from "@/renderer/shared/api/bindings";
import {
  COMPARE_VIEW_MODE,
  type CompareViewMode
} from "@/renderer/features/pdf-compare";
import { VIEWER_LAYOUT } from "../config/viewer-layout";

const HALF_TURN_DEGREES = 180;

interface PageBoxPt {
  widthPt: number;
  heightPt: number;
}

/**
 * 쪽이 화면에 놓이는 크기(pt). `page_sizes`의 보이는 영역에 회전 90·270이면 너비·높이를 바꾼다
 * (ADR 0001 §2: pdf.js가 쪽을 열기 전의 행 크기). `UserUnit`은 모르므로 곱하지 않는다.
 */
function pageBoxPt({ viewBox, rotation }: PageSize): PageBoxPt {
  const width = viewBox.right - viewBox.left;
  const height = viewBox.top - viewBox.bottom;
  return rotation % HALF_TURN_DEGREES === 0
    ? { widthPt: width, heightPt: height }
    : { widthPt: height, heightPt: width };
}

/** 그 보기 방식에서 보이는 문서 쪽 */
export function shownSidesOf(viewMode: CompareViewMode): readonly Side[] {
  switch (viewMode) {
    case COMPARE_VIEW_MODE.BEFORE_ONLY:
      return [COMPARE_SIDE.BEFORE];
    case COMPARE_VIEW_MODE.AFTER_ONLY:
      return [COMPARE_SIDE.AFTER];
    default:
      return COMPARE_SIDES;
  }
}

/** 행의 한 칸. `page`가 `null`이면 짝 없는 쪽 자리표시(반대편 쪽과 같은 크기) */
export interface RowSlot {
  side: Side;
  page: number | null;
  widthPx: number;
  heightPx: number;
}

/** 페이지 영역의 행 하나 = `page_pairs`의 한 쌍(계획서 P3-4) */
export interface ViewerRow {
  key: string;
  pair: PagePair;
  slots: RowSlot[];
  /** 나란히 보기의 거터 폭. 한쪽만 보면 `null` */
  gutterPx: number | null;
  heightPx: number;
}

/** 거터 폭(계획서 §7.1): 한쪽이라도 가로 쪽이면 좁힌다. */
function gutterPxOf(isLandscape: boolean): number {
  return isLandscape
    ? VIEWER_LAYOUT.GUTTER_LANDSCAPE_PX
    : VIEWER_LAYOUT.GUTTER_PORTRAIT_PX;
}

interface LayoutRowsParams {
  result: CompareResult;
  /** 1pt당 CSS px */
  scale: number;
  viewMode: CompareViewMode;
}

interface BoxOfParams {
  result: CompareResult;
  side: Side;
  page: number;
}

function boxOf({ result, side, page }: BoxOfParams): PageBoxPt {
  const size = result.pageSizes[side][page];
  return size ? pageBoxPt(size) : { widthPt: 0, heightPt: 0 };
}

/** 행마다 칸 크기·거터·높이. 행 높이 = 캡션 + 큰 쪽 높이 + 아래 여백 */
export function layoutRows({
  result,
  scale,
  viewMode
}: LayoutRowsParams): ViewerRow[] {
  const shownSides = shownSidesOf(viewMode);
  return result.pagePairs.map((pair) => {
    const boxes = COMPARE_SIDES.flatMap((side) => {
      const page = pageOfPair({ pair, side });
      return page === null ? [] : [boxOf({ result, side, page })];
    });
    const fallback = boxes[0] ?? { widthPt: 0, heightPt: 0 };
    const slots = shownSides.map((side): RowSlot => {
      const page = pageOfPair({ pair, side });
      const box = page === null ? fallback : boxOf({ result, side, page });
      return {
        side,
        page,
        widthPx: box.widthPt * scale,
        heightPx: box.heightPt * scale
      };
    });
    const isLandscape = boxes.some(
      ({ widthPt, heightPt }) => widthPt > heightPt
    );
    const tallest = Math.max(...slots.map(({ heightPx }) => heightPx));
    return {
      key: `${pair[0]}:${pair[1]}`,
      pair,
      slots,
      gutterPx: shownSides.length > 1 ? gutterPxOf(isLandscape) : null,
      heightPx:
        VIEWER_LAYOUT.CAPTION_HEIGHT_PX + tallest + VIEWER_LAYOUT.ROW_GAP_PX
    };
  });
}

interface FitScaleParams {
  result: CompareResult;
  viewMode: CompareViewMode;
  /** 페이지 영역 안쪽 너비(좌우 여백을 뺀 값) */
  contentWidthPx: number;
}

/** "맞춤": 보이는 쪽 중 가장 넓은 쪽이 칸에 여백을 두고 들어가는 배율(1pt당 CSS px) */
export function fitScaleOf({
  result,
  viewMode,
  contentWidthPx
}: FitScaleParams): number {
  const shownSides = shownSidesOf(viewMode);
  const widestPt = Math.max(
    0,
    ...result.pagePairs.flatMap((pair) =>
      shownSides.flatMap((side) => {
        const page = pageOfPair({ pair, side });
        return page === null ? [] : [boxOf({ result, side, page }).widthPt];
      })
    )
  );
  const gutterPx = shownSides.length > 1 ? VIEWER_LAYOUT.GUTTER_PORTRAIT_PX : 0;
  const columnWidthPx = (contentWidthPx - gutterPx) / shownSides.length;
  const pageWidthPx = columnWidthPx - VIEWER_LAYOUT.FIT_PAGE_MARGIN_PX * 2;
  return widestPt > 0 ? pageWidthPx / widestPt : 0;
}

/** 각 행의 위 끝(px). 마지막 값은 전체 높이 */
export function rowOffsetsOf(rows: readonly ViewerRow[]): number[] {
  return rows.reduce<number[]>(
    (offsets, row) => [...offsets, offsets[offsets.length - 1] + row.heightPx],
    [0]
  );
}
