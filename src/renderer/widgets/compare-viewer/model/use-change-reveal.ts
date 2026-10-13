import { useEffect, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import type { RowLookup } from "@/renderer/entities/comparison";
import type {
  CompareViewMode,
  CompletedComparison
} from "@/renderer/features/pdf-compare";
import { readPageGeometry } from "@/renderer/shared/lib/pdfjs";
import { VIEWER_LAYOUT } from "../config/viewer-layout";
import { revealTargetOf } from "../lib/change-position";
import type { ViewerRow } from "../lib/row-layout";

const ALIGN_START = "start";
const HALF = 2;

interface UseChangeRevealParams {
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  scroller: HTMLElement | null;
  rows: readonly ViewerRow[];
  rowLookup: RowLookup;
  completed: CompletedComparison;
  activeChangeId: string | null;
  /** 고를 때마다 늘어나는 요청 번호. 바뀔 때만 스크롤한다(처음 열 때는 맨 위에서 시작). */
  revealCount: number;
  viewMode: CompareViewMode;
}

/**
 * 변경을 고르면(목록·이전/다음·키보드) 그 변경의 첫 상자가 페이지 영역 가운데 오게 스크롤한다.
 * 상자의 세로 위치는 그 쪽의 pdf.js viewport 변환으로 구한다(ADR 0001 §2). 보기 방식에서 그 쪽이
 * 보이지 않으면 행의 맨 위로 간다.
 */
export function useChangeReveal({
  virtuosoRef,
  scroller,
  rows,
  rowLookup,
  completed,
  activeChangeId,
  revealCount,
  viewMode
}: UseChangeRevealParams): void {
  useEffect(() => {
    if (revealCount === 0 || activeChangeId === null) return;
    const change = completed.result.changes.find(
      ({ id }) => id === activeChangeId
    );
    const target = change
      ? revealTargetOf({ change, viewMode, rowLookup })
      : null;
    if (!target) return;
    const slot = rows[target.row]?.slots.find(
      ({ side, page }) => side === target.side && page !== null
    );
    const scrollToRowStart = () =>
      virtuosoRef.current?.scrollToIndex({
        index: target.row,
        align: ALIGN_START
      });
    if (!slot) {
      scrollToRowStart();
      return;
    }
    let isCancelled = false;
    readPageGeometry({
      path: completed.files[target.side].path,
      pageIndex: target.box.page
    }).then(
      (geometry) => {
        if (isCancelled) return;
        const rect = geometry.toViewportRect(target.box);
        const boxCenterPx =
          VIEWER_LAYOUT.CAPTION_HEIGHT_PX +
          ((rect.top + rect.height / HALF) / geometry.height) * slot.heightPx;
        const viewportHeight = scroller?.clientHeight ?? 0;
        virtuosoRef.current?.scrollToIndex({
          index: target.row,
          align: ALIGN_START,
          offset: boxCenterPx - viewportHeight / HALF
        });
      },
      () => {
        if (!isCancelled) scrollToRowStart();
      }
    );
    return () => {
      isCancelled = true;
    };
  }, [revealCount]);
}
