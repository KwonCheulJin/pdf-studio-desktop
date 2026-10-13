import {
  groupByRow,
  type ChangeKind,
  type NumberedChange,
  type RowLookup
} from "@/renderer/entities/comparison";
import { VIEWER_LAYOUT } from "../config/viewer-layout";
import type { ViewerRow } from "./row-layout";

const PERCENT = 100;
/** 행 안에서 눈금을 칸 가운데에 둔다. */
const TICK_CENTER = 0.5;

/** 미니맵 눈금 하나 */
export interface MinimapTick {
  changeId: string;
  kind: ChangeKind;
  /** 페이지 영역 전체 높이에 대한 위치(%) */
  topPercent: number;
}

interface MinimapTicksParams {
  changes: readonly NumberedChange[];
  rowLookup: RowLookup;
  rows: readonly ViewerRow[];
  /** `rowOffsetsOf` 결과(마지막 값이 전체 높이) */
  offsets: readonly number[];
}

/**
 * 미니맵 눈금. 변경이 있는 행(쪽 쌍) 안에서 변경 순서대로 쪽 높이를 고르게 나눈 자리에 둔다.
 * 쪽 안의 정확한 세로 위치는 pdf.js가 그 쪽을 열어야 알 수 있어(ADR 0001 §2) 쓰지 않는다.
 */
export function minimapTicksOf({
  changes,
  rowLookup,
  rows,
  offsets
}: MinimapTicksParams): MinimapTick[] {
  const totalHeight = offsets[offsets.length - 1];
  if (!totalHeight) return [];
  return groupByRow({ changes, rows: rowLookup }).flatMap((group) => {
    const row = group.row === null ? undefined : rows[group.row];
    if (group.row === null || !row) return [];
    const pageTop = offsets[group.row] + VIEWER_LAYOUT.CAPTION_HEIGHT_PX;
    const pageHeight =
      row.heightPx - VIEWER_LAYOUT.CAPTION_HEIGHT_PX - VIEWER_LAYOUT.ROW_GAP_PX;
    return group.changes.map(({ change }, index) => ({
      changeId: change.id,
      kind: change.kind,
      topPercent:
        ((pageTop +
          (pageHeight * (index + TICK_CENTER)) / group.changes.length) /
          totalHeight) *
        PERCENT
    }));
  });
}
