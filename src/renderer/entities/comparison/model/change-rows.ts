import type {
  Change,
  ChangeKind,
  CompareResult,
  Placement,
  Side,
  TextBox
} from "@/renderer/shared/api/bindings";
import { COMPARE_SIDE, PLACEMENT_KIND } from "../config/change-kind";

/** 한 행에 나란히 놓이는 쪽 짝 `[A 쪽, B 쪽]`. `null`은 그 문서에 짝이 없다(ADR 0001 §3). */
export type PagePair = CompareResult["pagePairs"][number];

/** 변경과 그 번호(결과 안 색인 + 1, 목록 `#n`과 페이지 번호 태그, ADR 0001 §4) */
export interface NumberedChange {
  change: Change;
  number: number;
}

/** 쪽 번호 → 행 번호. 각 쪽 번호는 한 행에만 있다(ADR 0001 §3). */
export type RowLookup = Record<Side, ReadonlyMap<number, number>>;

export function numberChanges(changes: readonly Change[]): NumberedChange[] {
  return changes.map((change, index) => ({ change, number: index + 1 }));
}

export function indexPagePairs(pagePairs: readonly PagePair[]): RowLookup {
  const rowsOf = (side: Side) =>
    new Map(
      pagePairs.flatMap((pair, row) => {
        const page = side === COMPARE_SIDE.BEFORE ? pair[0] : pair[1];
        return page === null ? [] : [[page, row] as const];
      })
    );
  return {
    [COMPARE_SIDE.BEFORE]: rowsOf(COMPARE_SIDE.BEFORE),
    [COMPARE_SIDE.AFTER]: rowsOf(COMPARE_SIDE.AFTER)
  };
}

/** 그 쪽에 변경 글자가 있는 `Placement`(상자와 글자) */
export type BoxesPlacement = Extract<
  Placement,
  { kind: typeof PLACEMENT_KIND.BOXES }
>;

interface ChangeSideParams {
  change: Change;
  side: Side;
}

/** 변경의 그 쪽 글자와 상자. 그 쪽에 글자가 없으면(앵커) `null`이다(앵커는 아직 그리지 않는다). */
export function changeSideOf({
  change,
  side
}: ChangeSideParams): BoxesPlacement | null {
  const placement = side === COMPARE_SIDE.BEFORE ? change.before : change.after;
  return placement.kind === PLACEMENT_KIND.BOXES ? placement : null;
}

interface RowOfChangeParams {
  change: Change;
  rows: RowLookup;
}

/** 변경이 속하는 행: A 쪽이 있으면 A 쪽 번호로, 없으면 B 쪽 번호로 찾는다(ADR 0001 §3). */
export function rowOfChange({
  change,
  rows
}: RowOfChangeParams): number | null {
  const [beforePage, afterPage] = change.pagePair;
  if (beforePage !== null) {
    return rows[COMPARE_SIDE.BEFORE].get(beforePage) ?? null;
  }
  if (afterPage !== null) {
    return rows[COMPARE_SIDE.AFTER].get(afterPage) ?? null;
  }
  return null;
}

/** 차이 목록의 쪽 묶음. 같은 행의 연속한 변경이다. */
export interface ChangeGroup {
  key: string;
  row: number | null;
  changes: NumberedChange[];
}

interface GroupByRowParams {
  changes: readonly NumberedChange[];
  rows: RowLookup;
}

/**
 * 쪽별 묶기. `changes`는 diff 순서이고 행 순서와 같은 방향이라(ADR 0001 §4) 그 순서 그대로
 * 이어진 같은 행끼리 묶는다.
 */
export function groupByRow({ changes, rows }: GroupByRowParams): ChangeGroup[] {
  return changes.reduce<ChangeGroup[]>((groups, numbered) => {
    const row = rowOfChange({ change: numbered.change, rows });
    const last = groups[groups.length - 1];
    if (last && last.row === row) {
      return [
        ...groups.slice(0, -1),
        { ...last, changes: [...last.changes, numbered] }
      ];
    }
    return [
      ...groups,
      { key: `${row}:${numbered.change.id}`, row, changes: [numbered] }
    ];
  }, []);
}

/** 쪽 하나 위에 그릴 변경 상자 */
export interface PageHighlight {
  changeId: string;
  number: number;
  kind: ChangeKind;
  needsReview: boolean;
  box: TextBox;
  /** 이 쪽에서 그 변경의 첫 상자(번호 태그를 단다) */
  isFirstOnPage: boolean;
}

/** 쪽 번호 → 그 쪽에 그릴 상자 */
export type PageHighlights = ReadonlyMap<number, readonly PageHighlight[]>;

interface HighlightsByPageParams {
  changes: readonly NumberedChange[];
  side: Side;
}

export function highlightsByPage({
  changes,
  side
}: HighlightsByPageParams): PageHighlights {
  const highlights = changes.flatMap(({ change, number }) => {
    const boxes = changeSideOf({ change, side })?.boxes ?? [];
    return boxes.map(
      (box, index): PageHighlight => ({
        changeId: change.id,
        number,
        kind: change.kind,
        needsReview: change.needsReview,
        box,
        isFirstOnPage:
          boxes.findIndex((other) => other.page === box.page) === index
      })
    );
  });
  return highlights.reduce(
    (byPage, highlight) =>
      byPage.set(highlight.box.page, [
        ...(byPage.get(highlight.box.page) ?? []),
        highlight
      ]),
    new Map<number, PageHighlight[]>()
  );
}
