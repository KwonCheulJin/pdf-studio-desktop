import type {
  Change,
  CompareResult,
  Placement,
  Side,
  TextBox
} from "@/renderer/shared/api/bindings";
import {
  COMPARE_SIDE,
  CONNECTOR_SHAPE,
  PLACEMENT_KIND,
  type ConnectorShape
} from "../config/change-kind";

/** 끝 상자가 이 줄 수를 넘으면 선 대신 띠로 잇는다(Rust `MAX_LINE_CONNECTOR_LINES`, 계획서 §7.1). */
const MAX_LINE_CONNECTOR_LINES = 2;
/**
 * 앞 상자와 세로로 낮은 쪽 높이의 이 비율 이상 겹치면 같은 줄이다(Rust `SAME_LINE_MIN_OVERLAP`,
 * ADR 0001 §10의 세로 조건).
 */
const SAME_LINE_MIN_OVERLAP = 0.5;

/**
 * Rust가 `f32`로 셈하므로 같은 줄 판정을 같은 값으로 내려고 값마다·연산마다 `f32`로 반올림한다. 덧셈·뺄셈은
 * 배정밀도로 계산한 뒤 `f32`로 반올림해도 `f32` 연산 결과와 같다.
 */
const f32 = Math.fround;

/**
 * 연결선 한쪽 끝(Rust `ConnectorEnd`). Rust의 줄 표시(`row`, 화면 방향 pt)는 화면에서 끝 사각형을 그 쪽
 * pdf.js 변환으로 옮겨 구한다(`widgets/compare-viewer`, ADR 0001 §2).
 */
export interface ConnectorEnd {
  /** 사용자 공간 사각형. 글자 쪽은 첫 상자의 쪽 상자들 합집합, 앵커는 너비 0인 막대다. */
  bounds: TextBox;
  isAnchor: boolean;
}

/** 변경 하나의 연결선(Rust `Connector`) */
export interface Connector {
  change: Change;
  shape: ConnectorShape;
  before: ConnectorEnd;
  after: ConnectorEnd;
}

function boxesOf(placement: Placement): TextBox[] {
  return placement.kind === PLACEMENT_KIND.BOXES ? placement.boxes : [];
}

/** 첫 상자의 쪽에 있는 상자들(텍스트 순서) */
function firstPageBoxes(boxes: readonly TextBox[]): TextBox[] {
  const [first] = boxes;
  return first ? boxes.filter(({ page }) => page === first.page) : [];
}

function unionOf(boxes: readonly TextBox[]): TextBox | null {
  const [first] = boxes;
  if (!first) return null;
  const left = Math.min(...boxes.map(({ x }) => x));
  const bottom = Math.min(...boxes.map(({ y }) => y));
  const right = Math.max(...boxes.map(({ x, w }) => x + w));
  const top = Math.max(...boxes.map(({ y, h }) => y + h));
  return {
    page: first.page,
    x: left,
    y: bottom,
    w: right - left,
    h: top - bottom
  };
}

/** 그 쪽의 연결선 끝(쪽 크기 확인 전) */
export function connectorEndOf(placement: Placement): ConnectorEnd | null {
  if (placement.kind === PLACEMENT_KIND.ANCHOR) {
    const { page, x, y, h } = placement;
    return { bounds: { page, x, y, w: 0, h }, isAnchor: true };
  }
  const bounds = unionOf(firstPageBoxes(placement.boxes));
  return bounds ? { bounds, isAnchor: false } : null;
}

function sharesLine(first: TextBox, second: TextBox): boolean {
  const overlap = f32(
    Math.min(
      f32(f32(first.y) + f32(first.h)),
      f32(f32(second.y) + f32(second.h))
    ) - Math.max(f32(first.y), f32(second.y))
  );
  return (
    overlap >=
    f32(SAME_LINE_MIN_OVERLAP * Math.min(f32(first.h), f32(second.h)))
  );
}

/**
 * 상자들이 걸친 줄 수. 텍스트 순서로 훑으며 앞 상자와 세로로 반 넘게 겹치지 않으면 새 줄이다. 가로
 * 간격은 보지 않는다(`Replace`의 글자 diff 상자와 2단의 두 상자는 한 줄에 여럿일 수 있다).
 */
function lineCountOf(boxes: readonly TextBox[]): number {
  if (boxes.length === 0) return 0;
  return boxes.reduce(
    (count, box, index) =>
      index > 0 && !sharesLine(boxes[index - 1], box) ? count + 1 : count,
    1
  );
}

interface ConnectorOfParams {
  change: Change;
  pageSizes: CompareResult["pageSizes"];
}

function isOnKnownPage(
  end: ConnectorEnd,
  sizes: CompareResult["pageSizes"][Side]
): boolean {
  return sizes[end.bounds.page] !== undefined;
}

/**
 * 변경 하나의 연결선(계획서 §7.1, 정본은 Rust `connectors`). 끝의 쪽이 `page_sizes`에 없으면(쪽이 0개인
 * 문서의 앵커, ADR 0001 §4) 잇지 않는다. 글자가 있는 쪽 끝 중 하나라도 2줄을 넘으면 띠다.
 */
export function connectorOf({
  change,
  pageSizes
}: ConnectorOfParams): Connector | null {
  const before = connectorEndOf(change.before);
  const after = connectorEndOf(change.after);
  if (
    !before ||
    !after ||
    !isOnKnownPage(before, pageSizes[COMPARE_SIDE.BEFORE]) ||
    !isOnKnownPage(after, pageSizes[COMPARE_SIDE.AFTER])
  ) {
    return null;
  }
  const lines = Math.max(
    lineCountOf(firstPageBoxes(boxesOf(change.before))),
    lineCountOf(firstPageBoxes(boxesOf(change.after)))
  );
  return {
    change,
    shape:
      lines > MAX_LINE_CONNECTOR_LINES
        ? CONNECTOR_SHAPE.BAND
        : CONNECTOR_SHAPE.LINE,
    before,
    after
  };
}
