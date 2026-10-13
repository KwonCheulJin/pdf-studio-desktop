import type {
  Change,
  ChangeKind,
  CompareResult,
  PageSize,
  Side,
  TextBox
} from "@/renderer/shared/api/bindings";
import { COMPARE_SIDE } from "../config/change-kind";
import {
  changeSideOf,
  type BoxesPlacement,
  type PagePair
} from "./change-rows";

/**
 * 이웃한 두 변경을 한 묶음으로 붙이는 세로 간격의 상한(pt). Rust `CONNECTOR_GAP_PT`와 같은 값이다
 * (계획서 §7.1, `crates/pdf-core/src/compare/connectors.rs`).
 */
const CONNECTOR_GAP_PT = 20;

const QUARTER_TURN = 90;
const HALF_TURN = 180;
const THREE_QUARTER_TURN = 270;

/**
 * Rust가 `f32`로 계산하므로 같은 묶음 경계를 내려고 값마다·연산마다 `f32`로 반올림한다. 덧셈·뺄셈은
 * 배정밀도로 계산한 뒤 `f32`로 반올림해도 `f32` 연산 결과와 같다.
 */
const f32 = Math.fround;

/** 선 하나로 이을 변경 묶음(계획서 §7.1). 모양은 Rust `ConnectorStem` golden과 같다. */
export interface ConnectorStem {
  /** 묶음 안 변경. A 읽는 순서다. */
  changeIds: string[];
  /** 묶음 안 변경의 종류가 하나면 그 종류, 섞이면 `null`(선택·호버에도 중립색) */
  kind: ChangeKind | null;
  /** 끝점 상자: 묶음 안 변경들이 그 행의 A 쪽에 둔 상자의 합집합(사용자 공간) */
  before: TextBox;
  /** 같은 변경들이 그 행의 B 쪽에 둔 상자의 합집합 */
  after: TextBox;
}

/** 가장자리로 쓴 상자(사용자 공간, f32) */
interface Edges {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** 화면 방향 좌표(`view_box` 왼쪽 아래 원점, y 위쪽)의 가장자리. 순서·간격에 쓰는 것만 둔다. */
interface ScreenEdges {
  left: number;
  bottom: number;
  top: number;
}

interface Placed {
  bounds: Edges;
  screen: ScreenEdges;
}

/** 이을 변경 하나 */
interface Linked {
  /** 입력 안 순번(읽는 순서 동률을 가른다) */
  index: number;
  change: Change;
  before: Placed;
  after: Placed;
}

function edgesOf({ x, y, w, h }: TextBox): Edges {
  return {
    left: f32(x),
    bottom: f32(y),
    right: f32(f32(x) + f32(w)),
    top: f32(f32(y) + f32(h))
  };
}

function unionOf(first: Edges, second: Edges): Edges {
  return {
    left: Math.min(first.left, second.left),
    bottom: Math.min(first.bottom, second.bottom),
    right: Math.max(first.right, second.right),
    top: Math.max(first.top, second.top)
  };
}

/**
 * 사용자 공간 상자를 화면 방향 가장자리로 옮긴다. `/Rotate`는 시계 방향이라 90이면 사용자 공간 왼쪽
 * 가장자리가 화면 위, 180이면 아래쪽 가장자리가 화면 위, 270이면 오른쪽 가장자리가 화면 위다.
 */
function screenEdgesOf(bounds: Edges, { viewBox, rotation }: PageSize) {
  const viewLeft = f32(viewBox.left);
  const viewBottom = f32(viewBox.bottom);
  const left = f32(bounds.left - viewLeft);
  const bottom = f32(bounds.bottom - viewBottom);
  const right = f32(bounds.right - viewLeft);
  const top = f32(bounds.top - viewBottom);
  const width = f32(f32(viewBox.right) - viewLeft);
  const height = f32(f32(viewBox.top) - viewBottom);
  switch (rotation) {
    case QUARTER_TURN:
      return {
        left: bottom,
        bottom: f32(width - right),
        top: f32(width - left)
      };
    case HALF_TURN:
      return {
        left: f32(width - right),
        bottom: f32(height - top),
        top: f32(height - bottom)
      };
    case THREE_QUARTER_TURN:
      return { left: f32(height - top), bottom: left, top: right };
    default:
      return { left, bottom, top };
  }
}

interface RowPage {
  page: number;
  size: PageSize;
}

/** 그 쪽에 있는 상자들의 합집합과 화면 방향 가장자리. 그 쪽에 상자가 없으면 `null` */
function placeOn(side: BoxesPlacement, { page, size }: RowPage): Placed | null {
  const onPage = side.boxes.filter((box) => box.page === page).map(edgesOf);
  if (onPage.length === 0) return null;
  const bounds = onPage.reduce(unionOf);
  return { bounds, screen: screenEdgesOf(bounds, size) };
}

function toTextBox(page: number, bounds: Edges): TextBox {
  return {
    page,
    x: bounds.left,
    y: bounds.bottom,
    w: f32(bounds.right - bounds.left),
    h: f32(bounds.top - bounds.bottom)
  };
}

/** 위쪽 모서리 내림차순 → 왼쪽 오름차순 → 순번 */
function compareReading(
  first: { edges: ScreenEdges; index: number },
  second: { edges: ScreenEdges; index: number }
): number {
  if (first.edges.top !== second.edges.top) {
    return second.edges.top > first.edges.top ? 1 : -1;
  }
  if (first.edges.left !== second.edges.left) {
    return first.edges.left > second.edges.left ? 1 : -1;
  }
  return first.index - second.index;
}

interface ReadingOrderParams {
  linked: readonly Linked[];
  side: Side;
}

/** 읽는 순서로 늘어놓은 `linked`의 위치들 */
function readingOrderOf({ linked, side }: ReadingOrderParams): number[] {
  return linked
    .map((link, position) => ({
      position,
      index: link.index,
      edges:
        side === COMPARE_SIDE.BEFORE ? link.before.screen : link.after.screen
    }))
    .sort(compareReading)
    .map(({ position }) => position);
}

/** 위 변경의 아래 끝과 아래 변경의 위 끝 사이가 간격 상한 이하인가(겹치면 음수라 붙는다) */
function isNear(earlier: ScreenEdges, current: ScreenEdges): boolean {
  return f32(earlier.bottom - current.top) <= CONNECTOR_GAP_PT;
}

interface WorkingStem {
  changes: Change[];
  before: Edges;
  after: Edges;
}

interface RowConnectorStemsParams {
  /** 화면에 보이는 변경(필터로 숨긴 변경은 뺀다). 순서는 결과 순서다. */
  changes: readonly Change[];
  pair: PagePair;
  pageSizes: CompareResult["pageSizes"];
}

/**
 * 행 하나의 연결선 묶음(계획서 §7.1, 정본은 Rust `connector_stems`). A·B 쪽이 모두 있고 첫 상자의 두
 * 쪽이 이 행의 두 쪽인 변경만 잇는다. A 읽는 순서로 훑으며 앞 변경과의 세로 간격이 A·B 모두 20pt
 * 이하이고 B 읽는 순서의 순위가 앞 변경의 순위 + 1일 때만 앞 묶음에 붙인다. 계산은 pt라 배율과
 * 상관없다. 한쪽이 없는 행(자리표시자)이면 빈 목록이다.
 */
export function rowConnectorStems({
  changes,
  pair,
  pageSizes
}: RowConnectorStemsParams): ConnectorStem[] {
  const [beforePage, afterPage] = pair;
  if (beforePage === null || afterPage === null) return [];
  const beforeSize = pageSizes.before[beforePage];
  const afterSize = pageSizes.after[afterPage];
  if (!beforeSize || !afterSize) return [];
  const beforeRow = { page: beforePage, size: beforeSize };
  const afterRow = { page: afterPage, size: afterSize };

  const linked = changes.flatMap((change, index): Linked[] => {
    const [changeBefore, changeAfter] = change.pagePair;
    if (changeBefore !== beforePage || changeAfter !== afterPage) return [];
    const beforeSide = changeSideOf({ change, side: COMPARE_SIDE.BEFORE });
    const afterSide = changeSideOf({ change, side: COMPARE_SIDE.AFTER });
    const before = beforeSide && placeOn(beforeSide, beforeRow);
    const after = afterSide && placeOn(afterSide, afterRow);
    return before && after ? [{ index, change, before, after }] : [];
  });
  const afterRank = readingOrderOf({ linked, side: COMPARE_SIDE.AFTER }).reduce(
    (ranks, position, rank) => ranks.set(position, rank),
    new Map<number, number>()
  );

  const stems = readingOrderOf({ linked, side: COMPARE_SIDE.BEFORE }).reduce<{
    stems: WorkingStem[];
    previous: number | null;
  }>(
    ({ stems: built, previous }, position) => {
      const current = linked[position];
      const last = built[built.length - 1];
      const joins =
        previous !== null &&
        last !== undefined &&
        afterRank.get(position) === (afterRank.get(previous) ?? 0) + 1 &&
        isNear(linked[previous].before.screen, current.before.screen) &&
        isNear(linked[previous].after.screen, current.after.screen);
      const next: WorkingStem[] = joins
        ? [
            ...built.slice(0, -1),
            {
              changes: [...last.changes, current.change],
              before: unionOf(last.before, current.before.bounds),
              after: unionOf(last.after, current.after.bounds)
            }
          ]
        : [
            ...built,
            {
              changes: [current.change],
              before: current.before.bounds,
              after: current.after.bounds
            }
          ];
      return { stems: next, previous: position };
    },
    { stems: [], previous: null }
  ).stems;

  return stems.map(({ changes: members, before, after }) => {
    const [first] = members;
    return {
      changeIds: members.map(({ id }) => id),
      kind: members.every(({ kind }) => kind === first.kind)
        ? first.kind
        : null,
      before: toTextBox(beforePage, before),
      after: toTextBox(afterPage, after)
    };
  });
}
