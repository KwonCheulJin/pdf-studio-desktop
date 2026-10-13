import { COMPARE_SIDE, type Side } from "@/renderer/entities/comparison";
import { VIEWER_LAYOUT } from "../config/viewer-layout";

const HALF = 2;

/** 패널 안쪽 좌우 여백(px) */
export interface PanePadding {
  left: number;
  right: number;
}

interface PanePaddingParams {
  side: Side;
  /** 나란히 보기(두 패널 사이에 거터가 있다) */
  isSplit: boolean;
}

/**
 * 페이지 영역 바깥 여백(시안 4 16px)은 영역의 바깥쪽에만 둔다. 나란히 보기는 A 패널 왼쪽과 B 패널
 * 오른쪽이고, 거터 쪽은 여백이 없다. 한쪽만 보기는 그 패널 양쪽이다.
 */
export function panePaddingOf({
  side,
  isSplit
}: PanePaddingParams): PanePadding {
  const padding = VIEWER_LAYOUT.AREA_PADDING_X_PX;
  if (!isSplit) return { left: padding, right: padding };
  return side === COMPARE_SIDE.BEFORE
    ? { left: padding, right: 0 }
    : { left: 0, right: padding };
}

interface PageLeftParams {
  /** 패널 안쪽 너비(세로 스크롤바 제외, `clientWidth`) */
  paneWidthPx: number;
  slotWidthPx: number;
  padding: PanePadding;
}

/**
 * 쪽이 패널 콘텐츠에 놓이는 왼쪽 끝(px). 쪽은 여백 안 칸의 가로 가운데(`margin-inline: auto`)이고, 칸보다
 * 넓으면 왼쪽 여백에 붙어 오른쪽으로 넘친다(가로 스크롤). 연결선 끝점이 화면 쪽과 같은 자리를 쓰도록
 * 행(`pane-row.tsx`)과 같은 여백·가운데 규칙을 한 곳에 둔다.
 */
export function pageLeftOf({
  paneWidthPx,
  slotWidthPx,
  padding
}: PageLeftParams): number {
  const columnWidthPx = paneWidthPx - padding.left - padding.right;
  return padding.left + Math.max(0, (columnWidthPx - slotWidthPx) / HALF);
}
