import { useEffect, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import {
  COMPARE_SIDE,
  connectorEndOf,
  type RowLookup,
  type Side
} from "@/renderer/entities/comparison";
import type {
  CompareViewMode,
  CompletedComparison
} from "@/renderer/features/pdf-compare";
import { readPageGeometry } from "@/renderer/shared/lib/pdfjs";
import { VIEWER_LAYOUT } from "../config/viewer-layout";
import { rowAt, shownSidesOf, type ViewerRow } from "../lib/row-layout";
import type { PaneScrollers } from "./use-pane-boxes";

const ALIGN_START = "start";
const HALF = 2;

/** 문서 쪽마다 패널의 virtuoso 핸들 */
export type PaneHandles = Record<Side, RefObject<VirtuosoHandle | null>>;

interface EndTarget {
  side: Side;
  row: number;
  /** 끝 세로 가운데(패널 콘텐츠 px). 쪽 변환을 받지 못하면 `null`(그 행 맨 위로) */
  centerY: number | null;
}

interface EndTargetParams {
  completed: CompletedComparison;
  changeId: string;
  side: Side;
  rows: readonly ViewerRow[];
  offsets: readonly number[];
  rowLookup: RowLookup;
}

/**
 * 변경의 그 쪽 끝(연결선 끝과 같다: 첫 쪽 상자 합집합 또는 앵커)의 패널 콘텐츠 세로 가운데. 상자의 세로
 * 위치는 그 쪽의 pdf.js viewport 변환으로 구한다(ADR 0001 §2). 끝의 쪽이 비교 범위에 없으면 `null`이다.
 */
async function endTargetOf({
  completed,
  changeId,
  side,
  rows,
  offsets,
  rowLookup
}: EndTargetParams): Promise<EndTarget | null> {
  const change = completed.result.changes.find(({ id }) => id === changeId);
  if (!change) return null;
  const end = connectorEndOf(
    side === COMPARE_SIDE.BEFORE ? change.before : change.after
  );
  const row = end ? rowLookup[side].get(end.bounds.page) : undefined;
  const slot =
    row === undefined
      ? undefined
      : rows[row]?.slots.find((candidate) => candidate.side === side);
  if (!end || row === undefined || !slot) return null;
  try {
    const geometry = await readPageGeometry({
      path: completed.files[side].path,
      pageIndex: end.bounds.page
    });
    const rect = geometry.toViewportRect(end.bounds);
    const centerInPage =
      ((rect.top + rect.height / HALF) / geometry.height) * slot.heightPx;
    return {
      side,
      row,
      centerY: offsets[row] + VIEWER_LAYOUT.CAPTION_HEIGHT_PX + centerInPage
    };
  } catch {
    return { side, row, centerY: null };
  }
}

interface UseChangeRevealParams {
  handles: PaneHandles;
  scrollers: PaneScrollers;
  rows: readonly ViewerRow[];
  offsets: readonly number[];
  rowLookup: RowLookup;
  completed: CompletedComparison;
  activeChangeId: string | null;
  /** 고를 때마다 늘어나는 요청 번호. 바뀔 때만 스크롤한다(처음 열 때는 맨 위에서 시작). */
  revealCount: number;
  viewMode: CompareViewMode;
  isScrollSynced: boolean;
}

/**
 * 변경을 고르면(목록·이전/다음·키보드·연결선 누르기) 보이는 패널마다 그 변경의 끝이 화면 세로 가운데에
 * 오게 스크롤한다(계획서 §7.1 "click"). 끝은 연결선 끝과 같다(삽입의 A·삭제의 B는 앵커). 나란히 보기에서
 * 동기 스크롤이 켜져 있으면 두 패널을 같은 위치로 두고 두 끝의 가운데를 화면 가운데에 둔다. 쪽 변환을
 * 받지 못하면 그 행 맨 위로 간다.
 */
export function useChangeReveal({
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
}: UseChangeRevealParams): void {
  useEffect(() => {
    if (revealCount === 0 || activeChangeId === null) return;
    const sides = shownSidesOf(viewMode);
    let isCancelled = false;
    Promise.all(
      sides.map((side) =>
        endTargetOf({
          completed,
          changeId: activeChangeId,
          side,
          rows,
          offsets,
          rowLookup
        })
      )
    ).then((ends) => {
      if (isCancelled) return;
      const targets = ends.flatMap((end) => (end ? [end] : []));
      // 행 + 행 안 거리로 옮긴다. 패널을 막 새로 만든 뒤(배율·보기 방식 변경)에도 virtuoso의 첫 행 맞추기가
      // 이 이동을 덮어쓰지 않는다(위치만 주는 `scrollTo`는 덮인다).
      const scrollTo = (side: Side, centerY: number) => {
        const viewportHeight = scrollers[side]?.clientHeight ?? 0;
        const top = Math.max(0, centerY - viewportHeight / HALF);
        const row = rowAt({ offsets, top });
        handles[side].current?.scrollToIndex({
          index: row,
          align: ALIGN_START,
          offset: top - offsets[row]
        });
      };
      const centered = targets.flatMap(({ centerY }) =>
        centerY === null ? [] : [centerY]
      );
      if (isScrollSynced && sides.length > 1 && centered.length > 0) {
        const middle =
          centered.reduce((sum, value) => sum + value, 0) / centered.length;
        sides.forEach((side) => scrollTo(side, middle));
        return;
      }
      targets.forEach(({ side, row, centerY }) => {
        if (centerY === null) {
          handles[side].current?.scrollToIndex({
            index: row,
            align: ALIGN_START
          });
        } else {
          scrollTo(side, centerY);
        }
      });
    });
    return () => {
      isCancelled = true;
    };
  }, [revealCount]);
}
