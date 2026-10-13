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

/**
 * 페이지 영역의 행 하나 = `page_pairs`의 한 쌍(계획서 P3-4). 두 패널이 같은 행 배치를 쓴다: A 패널의
 * 행 `i`와 B 패널의 행 `i`는 같은 쌍이고 높이가 같다(두 쪽 중 큰 쪽). 그래서 두 패널의 행 위치와
 * 전체 높이가 같고, 동기 스크롤은 스크롤 위치를 그대로 맞춘다(계획서 §7.1).
 */
export interface ViewerRow {
  key: string;
  pair: PagePair;
  /** 보이는 문서 쪽마다 한 칸(나란히는 A·B, 한쪽만 보기는 그 쪽) */
  slots: RowSlot[];
  heightPx: number;
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

/** 행마다 칸 크기·높이. 행 높이 = 캡션 + 큰 쪽 높이 + 아래 여백 */
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
    const tallest = Math.max(...slots.map(({ heightPx }) => heightPx));
    return {
      key: `${pair[0]}:${pair[1]}`,
      pair,
      slots,
      heightPx:
        VIEWER_LAYOUT.CAPTION_HEIGHT_PX + tallest + VIEWER_LAYOUT.ROW_GAP_PX
    };
  });
}

interface FitScaleParams {
  result: CompareResult;
  viewMode: CompareViewMode;
  /** 쪽 하나가 놓이는 칸의 너비(패널 안쪽에서 바깥 여백을 뺀 값) */
  columnWidthPx: number;
}

/** "맞춤": 보이는 쪽 중 가장 넓은 쪽이 칸에 여백을 두고 들어가는 배율(1pt당 CSS px) */
export function fitScaleOf({
  result,
  viewMode,
  columnWidthPx
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

interface RowAtParams {
  /** `rowOffsetsOf` 결과 */
  offsets: readonly number[];
  /** 콘텐츠 세로 위치(px) */
  top: number;
}

/** `top`이 걸친 행(`offsets`는 행 위 끝, 마지막 값은 전체 높이) */
export function rowAt({ offsets, top }: RowAtParams): number {
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
