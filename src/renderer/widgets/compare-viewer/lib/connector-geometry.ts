import {
  COMPARE_SIDE,
  CONNECTOR_SHAPE,
  type ChangeKind,
  type ConnectorEnd,
  type ConnectorShape,
  type Side
} from "@/renderer/entities/comparison";
import type { PageGeometry } from "@/renderer/shared/lib/pdfjs";
import type { ValueOf } from "@/renderer/shared/types/common";

/**
 * 연결선 좌표 계산(계획서 §7.1). 모두 순수 함수이고 단위는 CSS px다(원점 왼쪽 위, y 아래로).
 *
 * ```
 * PDF pt(상자·앵커)
 *   → 그 쪽 pdf.js viewport(배율 1) → 쪽이 놓인 크기에 비율로   ┐ toContentRect: 결과·배율·배치가
 *   → + 쪽이 패널 콘텐츠에 놓인 자리                              ┘ 바뀔 때만(캐시)
 *   → − 패널 스크롤 → + 패널이 오버레이에 놓인 자리                  toOverlayRect: 프레임마다
 * ```
 */

const HALF = 2;
/** path 좌표를 소수 둘째 자리로 반올림한다(부동소수점 잡음으로 문자열이 바뀌어 다시 쓰지 않게). */
const COORDINATE_SCALE = 100;

/** 화면 사각형(px) */
export interface PxRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 쪽 그림이 패널 콘텐츠에 놓인 자리(px) */
export interface PagePlacement {
  left: number;
  top: number;
  widthPx: number;
  heightPx: number;
}

/** 패널이 오버레이에 놓인 자리(px)와 지금 스크롤 */
export interface PaneOffset {
  left: number;
  top: number;
  scrollLeft: number;
  scrollTop: number;
}

interface ToContentRectParams {
  geometry: PageGeometry;
  /** 사용자 공간 사각형(앵커는 너비 0) */
  bounds: ConnectorEnd["bounds"];
  page: PagePlacement;
}

/**
 * 앞 두 단계: 사용자 공간 사각형을 그 쪽의 배율 1 viewport로 바꾸고(회전·CropBox 원점·`UserUnit`,
 * ADR 0001 §2, 손 공식 없음) 쪽이 놓인 크기에 비율로 맞춘 뒤 쪽의 자리를 더한다.
 */
export function toContentRect({
  geometry,
  bounds,
  page
}: ToContentRectParams): PxRect {
  const rect = geometry.toViewportRect(bounds);
  const scaleX = page.widthPx / geometry.width;
  const scaleY = page.heightPx / geometry.height;
  return {
    left: page.left + rect.left * scaleX,
    top: page.top + rect.top * scaleY,
    right: page.left + (rect.left + rect.width) * scaleX,
    bottom: page.top + (rect.top + rect.height) * scaleY
  };
}

interface ToOverlayRectParams {
  rect: PxRect;
  pane: PaneOffset;
}

/** 뒤 두 단계: 패널 콘텐츠 좌표에서 스크롤을 빼고 패널이 오버레이에 놓인 자리를 더한다. */
export function toOverlayRect({ rect, pane }: ToOverlayRectParams): PxRect {
  const dx = pane.left - pane.scrollLeft;
  const dy = pane.top - pane.scrollTop;
  return {
    left: rect.left + dx,
    top: rect.top + dy,
    right: rect.right + dx,
    bottom: rect.bottom + dy
  };
}

/** 연결선 한쪽 끝의 자리(px): 연결선이 나가는 x, 줄 표시(띠 변)의 위·아래 */
export interface EndSpan {
  x: number;
  top: number;
  bottom: number;
}

/** 쪽 그림의 가로 범위(px) */
export interface PageSpan {
  left: number;
  right: number;
}

interface EndSpanParams {
  /** 끝 사각형(상자 합집합 또는 앵커 막대)의 화면 사각형 */
  rect: PxRect;
  /** 끝이 놓인 쪽의 가로 범위 */
  page: PageSpan;
  side: Side;
}

/**
 * 끝의 자리(계획서 §7.1, Step 28-d): 끝마다 쪽 너비 전체 × 끝 사각형의 세로 범위인 줄 표시가 있고,
 * 연결선은 줄 표시의 거터를 향한 변(A는 쪽 오른쪽 끝, B는 쪽 왼쪽 끝)의 세로 가운데에서 나간다(Rust
 * `exit_point`). 90·270도 쪽 앵커 막대는 화면에서 가로로 놓여 높이 0인 줄 표시(띠 변)가 된다.
 */
export function endSpanOf({ rect, page, side }: EndSpanParams): EndSpan {
  return {
    x: side === COMPARE_SIDE.BEFORE ? page.right : page.left,
    top: rect.top,
    bottom: rect.bottom
  };
}

function centerOf(span: EndSpan): number {
  return (span.top + span.bottom) / HALF;
}

/** 세로로 보이는 범위(px) */
export interface VisibleRange {
  top: number;
  bottom: number;
}

export const CONNECTOR_STATE = {
  /** 두 끝이 모두 화면 밖: 그리지 않는다. */
  HIDDEN: "hidden",
  /** 두 끝이 모두 보인다. */
  SHOWN: "shown",
  /** 한 끝만 보인다: 다른 끝을 패널 위·아래 경계로 끌어와 흐린 점선으로 */
  CLAMPED: "clamped"
} as const;

export type ConnectorState = ValueOf<typeof CONNECTOR_STATE>;

export const CLAMP_EDGE = {
  TOP: "top",
  BOTTOM: "bottom"
} as const;

export type ClampEdge = ValueOf<typeof CLAMP_EDGE>;

export type Culled =
  | { state: typeof CONNECTOR_STATE.HIDDEN }
  | { state: typeof CONNECTOR_STATE.SHOWN }
  | {
      state: typeof CONNECTOR_STATE.CLAMPED;
      /** 화면 밖인 끝 */
      side: Side;
      edge: ClampEdge;
    };

interface CullParams {
  ends: Record<Side, EndSpan>;
  views: Record<Side, VisibleRange>;
}

/** 끝이 보이는가: 끝의 세로 범위가 보이는 범위와 닿는다(경계에 정확히 닿아도 보인다). */
function isVisible(span: EndSpan, view: VisibleRange): boolean {
  return span.bottom >= view.top && span.top <= view.bottom;
}

/**
 * 컬링(계획서 §7.1): 두 끝이 모두 보이면 그리고, 모두 화면 밖이면 그리지 않고, 한쪽만 밖이면 그 끝을
 * 끌어올 경계(위·아래)를 정한다. 같은 좌표계(오버레이 또는 그 패널 콘텐츠)의 값을 받는다.
 */
export function cullConnector({ ends, views }: CullParams): Culled {
  const beforeVisible = isVisible(ends.before, views.before);
  const afterVisible = isVisible(ends.after, views.after);
  if (beforeVisible && afterVisible) return { state: CONNECTOR_STATE.SHOWN };
  if (!beforeVisible && !afterVisible) {
    return { state: CONNECTOR_STATE.HIDDEN };
  }
  const side = beforeVisible ? COMPARE_SIDE.AFTER : COMPARE_SIDE.BEFORE;
  const edge =
    ends[side].bottom < views[side].top ? CLAMP_EDGE.TOP : CLAMP_EDGE.BOTTOM;
  return { state: CONNECTOR_STATE.CLAMPED, side, edge };
}

/** 두 패널 사이 거터의 양 끝(오버레이 x): A 패널 오른쪽 끝, B 패널 왼쪽 끝 */
export interface GutterEdges {
  left: number;
  right: number;
}

export interface Point {
  x: number;
  y: number;
}

function rounded(value: number): number {
  return Math.round(value * COORDINATE_SCALE) / COORDINATE_SCALE;
}

/** 거터 3차 베지어: 지금 점 `from`에서 `to`까지. 제어점은 각 끝에서 거터 반 폭만큼 상대 쪽으로 */
function crossing(from: Point, to: Point): string {
  const half = (to.x - from.x) / HALF;
  return `C${rounded(from.x + half)} ${rounded(from.y)} ${rounded(to.x - half)} ${rounded(to.y)} ${rounded(to.x)} ${rounded(to.y)}`;
}

interface LinePathParams {
  start: Point;
  end: Point;
  gutter: GutterEdges;
}

/**
 * 선 연결선: 1) A 줄 표시의 쪽 끝 → A 패널 끝까지 수평 2) 거터 3차 베지어 `C (gl + g/2, y1) (gr − g/2, y2)
 * (gr, y2)` 3) B 패널 끝 → B 줄 표시의 쪽 끝까지 수평
 */
export function connectorPath({ start, end, gutter }: LinePathParams): string {
  const gutterStart = { x: gutter.left, y: start.y };
  const gutterEnd = { x: gutter.right, y: end.y };
  return `M${rounded(start.x)} ${rounded(start.y)} H${rounded(gutter.left)} ${crossing(gutterStart, gutterEnd)} H${rounded(end.x)}`;
}

/** 거터 구간만(마우스를 받는 선) */
export function gutterLinePath({ start, end, gutter }: LinePathParams): string {
  const gutterStart = { x: gutter.left, y: start.y };
  const gutterEnd = { x: gutter.right, y: end.y };
  return `M${rounded(gutterStart.x)} ${rounded(gutterStart.y)} ${crossing(gutterStart, gutterEnd)}`;
}

interface BandPathParams {
  before: EndSpan;
  after: EndSpan;
  gutter: GutterEdges;
}

/**
 * 띠(2줄 넘는 블록): A 줄 표시 [위, 아래]와 B 줄 표시 [위, 아래]를 위 변·아래 변 두 베지어로 이은 닫힌
 * 경로. 양끝은 각 쪽 끝(줄 표시의 거터 쪽 변)에서 수평으로 거터까지 간다.
 */
export function bandPath({ before, after, gutter }: BandPathParams): string {
  const topStart = { x: gutter.left, y: before.top };
  const topEnd = { x: gutter.right, y: after.top };
  const bottomStart = { x: gutter.right, y: after.bottom };
  const bottomEnd = { x: gutter.left, y: before.bottom };
  return [
    `M${rounded(before.x)} ${rounded(before.top)} H${rounded(gutter.left)}`,
    crossing(topStart, topEnd),
    `H${rounded(after.x)} V${rounded(after.bottom)} H${rounded(gutter.right)}`,
    crossing(bottomStart, bottomEnd),
    `H${rounded(before.x)} Z`
  ].join(" ");
}

/** 띠의 거터 구간만(마우스를 받는 면) */
export function gutterBandPath({
  before,
  after,
  gutter
}: BandPathParams): string {
  const topStart = { x: gutter.left, y: before.top };
  const topEnd = { x: gutter.right, y: after.top };
  const bottomStart = { x: gutter.right, y: after.bottom };
  const bottomEnd = { x: gutter.left, y: before.bottom };
  return [
    `M${rounded(topStart.x)} ${rounded(topStart.y)}`,
    crossing(topStart, topEnd),
    `V${rounded(after.bottom)}`,
    crossing(bottomStart, bottomEnd),
    "Z"
  ].join(" ");
}

interface ChevronParams {
  tip: Point;
  edge: ClampEdge;
  size: number;
}

/** 방향 표시: 화면 밖 끝이 있는 쪽(위·아래)을 가리키는 V자. 꼭짓점이 `tip`이다. */
export function chevronPath({ tip, edge, size }: ChevronParams): string {
  const back = edge === CLAMP_EDGE.TOP ? size : -size;
  return `M${rounded(tip.x - size)} ${rounded(tip.y + back)} L${rounded(tip.x)} ${rounded(tip.y)} L${rounded(tip.x + size)} ${rounded(tip.y + back)}`;
}

/** 패널 하나의 지금 화면: 오버레이에 놓인 자리, 스크롤, 보이는 크기(px) */
export interface PaneFrame extends PaneOffset {
  width: number;
  height: number;
}

/** 한 프레임에 그릴 연결선 하나 */
export type ConnectorFrame =
  | { state: typeof CONNECTOR_STATE.HIDDEN }
  | {
      state: typeof CONNECTOR_STATE.SHOWN;
      shape: ConnectorShape;
      /** 보이는 경로(선 또는 띠) */
      d: string;
      /** 마우스를 받는 경로(거터 구간) */
      hitD: string;
    }
  | {
      state: typeof CONNECTOR_STATE.CLAMPED;
      side: Side;
      edge: ClampEdge;
      d: string;
      hitD: string;
      markerD: string;
    };

/** 연결선 하나의 콘텐츠 좌표(결과·배율·배치가 바뀔 때만 다시 계산) */
export interface ConnectorLayoutItem {
  changeId: string;
  kind: ChangeKind;
  shape: ConnectorShape;
  ends: Record<Side, EndSpan>;
}

interface ConnectorFrameParams {
  item: ConnectorLayoutItem;
  panes: Record<Side, PaneFrame>;
  gutter: GutterEdges;
  /** 화면 밖 끝을 패널 경계에서 들여놓는 거리와 방향 표시 크기 */
  clampInset: number;
  chevronSize: number;
}

function toOverlaySpan(span: EndSpan, pane: PaneFrame): EndSpan {
  const rect = toOverlayRect({
    rect: { left: span.x, top: span.top, right: span.x, bottom: span.bottom },
    pane
  });
  return { x: rect.left, top: rect.top, bottom: rect.bottom };
}

/** 끝점 x를 그 패널의 보이는 가로 범위로 자른다(가로로 스크롤해 상자가 패널 밖에 있을 때). */
function clampX(x: number, pane: PaneFrame): number {
  return Math.min(pane.left + pane.width, Math.max(pane.left, x));
}

/**
 * 프레임마다 연결선 하나를 오버레이 좌표로 그린다(스크롤만 바뀐다). 보이면 모양대로, 한쪽만 보이면
 * 화면 밖 끝을 패널 위·아래 경계(들여놓은 자리)로 끌어온 선과 방향 표시, 둘 다 밖이면 그리지 않는다.
 */
export function connectorFrameOf({
  item,
  panes,
  gutter,
  clampInset,
  chevronSize
}: ConnectorFrameParams): ConnectorFrame {
  const overlay: Record<Side, EndSpan> = {
    [COMPARE_SIDE.BEFORE]: toOverlaySpan(
      item.ends.before,
      panes[COMPARE_SIDE.BEFORE]
    ),
    [COMPARE_SIDE.AFTER]: toOverlaySpan(
      item.ends.after,
      panes[COMPARE_SIDE.AFTER]
    )
  };
  const views: Record<Side, VisibleRange> = {
    [COMPARE_SIDE.BEFORE]: {
      top: panes.before.top,
      bottom: panes.before.top + panes.before.height
    },
    [COMPARE_SIDE.AFTER]: {
      top: panes.after.top,
      bottom: panes.after.top + panes.after.height
    }
  };
  const culled = cullConnector({ ends: overlay, views });
  if (culled.state === CONNECTOR_STATE.HIDDEN) {
    return { state: CONNECTOR_STATE.HIDDEN };
  }
  const before = {
    ...overlay.before,
    x: clampX(overlay.before.x, panes.before)
  };
  const after = { ...overlay.after, x: clampX(overlay.after.x, panes.after) };
  if (culled.state === CONNECTOR_STATE.SHOWN) {
    const ends = { before, after, gutter };
    const line = {
      start: { x: before.x, y: centerOf(before) },
      end: { x: after.x, y: centerOf(after) },
      gutter
    };
    const isBand = item.shape === CONNECTOR_SHAPE.BAND;
    return {
      state: CONNECTOR_STATE.SHOWN,
      shape: item.shape,
      d: isBand ? bandPath(ends) : connectorPath(line),
      hitD: isBand ? gutterBandPath(ends) : gutterLinePath(line)
    };
  }
  const view = views[culled.side];
  const clampedY =
    culled.edge === CLAMP_EDGE.TOP
      ? view.top + clampInset
      : view.bottom - clampInset;
  const clampedEnd = culled.side === COMPARE_SIDE.BEFORE ? before : after;
  const tip = { x: clampedEnd.x, y: clampedY };
  const point = (span: EndSpan, side: Side) =>
    side === culled.side ? tip : { x: span.x, y: centerOf(span) };
  const line = {
    start: point(before, COMPARE_SIDE.BEFORE),
    end: point(after, COMPARE_SIDE.AFTER),
    gutter
  };
  return {
    state: CONNECTOR_STATE.CLAMPED,
    side: culled.side,
    edge: culled.edge,
    d: connectorPath(line),
    hitD: gutterLinePath(line),
    markerD: chevronPath({ tip, edge: culled.edge, size: chevronSize })
  };
}

/** 한 패널의 끝을 위 끝 오름차순으로 늘어놓은 색인(컬링 후보 이분 탐색) */
export interface EndIndex {
  /** 위 끝 오름차순 */
  tops: number[];
  /** `tops`와 같은 순서의 연결선 위치(`ConnectorLayoutItem` 배열 안) */
  items: number[];
  /** 끝 세로 길이의 최댓값(띠 끝은 여러 줄이다). 위 끝으로 찾을 때 이만큼 위를 더 본다. */
  maxSpan: number;
}

interface EndIndexParams {
  items: readonly ConnectorLayoutItem[];
  side: Side;
}

export function endIndexOf({ items, side }: EndIndexParams): EndIndex {
  const order = items
    .map((item, position) => ({ position, span: item.ends[side] }))
    .sort((first, second) => first.span.top - second.span.top);
  return {
    tops: order.map(({ span }) => span.top),
    items: order.map(({ position }) => position),
    maxSpan: Math.max(0, ...order.map(({ span }) => span.bottom - span.top))
  };
}

/** `values`(오름차순)에서 `target` 이상인 첫 위치 */
function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / HALF);
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** `values`(오름차순)에서 `target`보다 큰 첫 위치 */
function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / HALF);
    if (values[middle] <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

interface CandidatesParams {
  index: EndIndex;
  /** 그 패널의 보이는 콘텐츠 범위(스크롤 위치 ~ 위치 + 높이) */
  view: VisibleRange;
}

/**
 * 그 패널에서 끝이 보이는 범위에 닿을 수 있는 연결선 후보. 위 끝으로 찾되 끝 세로 길이 최댓값(여유분)
 * 만큼 위를 더 본다. 최종 판정은 `cullConnector`가 한다.
 */
export function candidatesOf({ index, view }: CandidatesParams): number[] {
  const from = lowerBound(index.tops, view.top - index.maxSpan);
  const to = upperBound(index.tops, view.bottom);
  return index.items.slice(from, to);
}
