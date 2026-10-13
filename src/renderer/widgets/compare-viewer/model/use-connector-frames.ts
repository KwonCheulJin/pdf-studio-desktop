import { useEffect, type RefObject } from "react";
import {
  COMPARE_SIDE,
  CONNECTOR_SHAPE,
  type Side
} from "@/renderer/entities/comparison";
import { CONNECTOR_STYLE } from "../config/viewer-layout";
import {
  candidatesOf,
  connectorFrameOf,
  CONNECTOR_STATE,
  type ConnectorFrame,
  type PaneFrame
} from "../lib/connector-geometry";
import type { ConnectorLayout } from "./use-connector-layout";
import type { PaneBox, PaneBoxes, PaneScrollers } from "./use-pane-boxes";

/** 연결선 `<g>` 안 경로의 역할(`data-part`) */
export const CONNECTOR_PART = {
  HIT: "hit",
  LINE: "line",
  BAND: "band",
  MARKER: "marker"
} as const;

/** 프레임마다 DOM에 쓰는 속성(상태는 E2E가 읽는다) */
const FRAME_ATTRIBUTE = {
  STATE: "data-state",
  CLAMPED_SIDE: "data-clamped-side",
  CLAMP_EDGE: "data-clamp-edge",
  DISPLAY: "display",
  OPACITY: "opacity",
  DASH: "stroke-dasharray",
  FILL: "fill",
  PATH: "d"
} as const;

const DISPLAY_NONE = "none";

/** 마우스를 받는 경로의 채움: 띠는 면 전체, 선은 선만 */
const HIT_FILL = {
  AREA: "transparent",
  NONE: "none"
} as const;

interface ConnectorParts {
  hit: SVGPathElement | null;
  line: SVGPathElement | null;
  band: SVGPathElement | null;
  marker: SVGPathElement | null;
}

/** `<g>`마다 경로들(처음 쓸 때 한 번 찾는다) */
const partsCache = new WeakMap<SVGGElement, ConnectorParts>();

function partsOf(group: SVGGElement): ConnectorParts {
  const cached = partsCache.get(group);
  if (cached) return cached;
  const part = (name: string) =>
    group.querySelector<SVGPathElement>(`[data-part="${name}"]`);
  const parts = {
    hit: part(CONNECTOR_PART.HIT),
    line: part(CONNECTOR_PART.LINE),
    band: part(CONNECTOR_PART.BAND),
    marker: part(CONNECTOR_PART.MARKER)
  };
  partsCache.set(group, parts);
  return parts;
}

/** 값이 `null`이면 속성을 지운다. */
function setAttribute(
  element: Element | null,
  name: string,
  value: string | null
): void {
  if (!element) return;
  if (value === null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
}

/** 그 프레임의 모양을 DOM에 쓴다(React를 거치지 않는다). */
function writeFrame(group: SVGGElement, frame: ConnectorFrame): void {
  const parts = partsOf(group);
  const isHidden = frame.state === CONNECTOR_STATE.HIDDEN;
  const isClamped = frame.state === CONNECTOR_STATE.CLAMPED;
  setAttribute(group, FRAME_ATTRIBUTE.STATE, frame.state);
  setAttribute(group, FRAME_ATTRIBUTE.DISPLAY, isHidden ? DISPLAY_NONE : null);
  setAttribute(
    group,
    FRAME_ATTRIBUTE.CLAMPED_SIDE,
    isClamped ? frame.side : null
  );
  setAttribute(
    group,
    FRAME_ATTRIBUTE.CLAMP_EDGE,
    isClamped ? frame.edge : null
  );
  if (isHidden) return;
  const isBand =
    frame.state === CONNECTOR_STATE.SHOWN &&
    frame.shape === CONNECTOR_SHAPE.BAND;
  setAttribute(parts.band, FRAME_ATTRIBUTE.PATH, isBand ? frame.d : null);
  setAttribute(parts.line, FRAME_ATTRIBUTE.PATH, isBand ? null : frame.d);
  setAttribute(parts.hit, FRAME_ATTRIBUTE.PATH, frame.hitD);
  setAttribute(
    parts.hit,
    FRAME_ATTRIBUTE.FILL,
    isBand ? HIT_FILL.AREA : HIT_FILL.NONE
  );
  setAttribute(
    parts.marker,
    FRAME_ATTRIBUTE.PATH,
    isClamped ? frame.markerD : null
  );
  setAttribute(
    group,
    FRAME_ATTRIBUTE.OPACITY,
    isClamped ? String(CONNECTOR_STYLE.CLAMPED_OPACITY) : null
  );
  setAttribute(
    parts.line,
    FRAME_ATTRIBUTE.DASH,
    isClamped ? CONNECTOR_STYLE.CLAMPED_DASH : null
  );
}

function frameKey(frame: ConnectorFrame): string {
  return frame.state === CONNECTOR_STATE.HIDDEN
    ? frame.state
    : `${frame.state}|${frame.d}|${frame.hitD}`;
}

function paneFrameOf(box: PaneBox, scroller: HTMLElement): PaneFrame {
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    scrollLeft: scroller.scrollLeft,
    scrollTop: scroller.scrollTop
  };
}

interface UseConnectorFramesParams {
  layout: ConnectorLayout | null;
  scrollers: PaneScrollers;
  paneBoxes: PaneBoxes | null;
  /** 연결선 id → 그 `<g>`(오버레이가 ref로 채운다) */
  groups: RefObject<Map<string, SVGGElement>>;
  /** 화면에서 사라진 연결선이 가리킨 것이면 호버를 푼다. */
  onHidden: (changeId: string) => void;
}

/**
 * 연결선 갱신(계획서 §7.1 갱신 전략). 두 패널의 scroll 이벤트를 rAF로 묶어 프레임당 한 번 계산하고, 보일
 * 수 있는 후보(패널마다 이분 탐색)만 다시 그린다. 결과는 path의 `d`·상태 속성을 DOM에 바로 쓴다. 스크롤마다
 * React 상태를 바꾸지 않는다(측정: 계획서 §7.1 "Step 28-c에서 정한 것").
 */
export function useConnectorFrames({
  layout,
  scrollers,
  paneBoxes,
  groups,
  onHidden
}: UseConnectorFramesParams): void {
  const { before, after } = scrollers;

  useEffect(() => {
    const beforeBox = paneBoxes?.before;
    const afterBox = paneBoxes?.after;
    if (!layout || !before || !after || !beforeBox || !afterBox) return;
    const gutter = { left: beforeBox.outerRight, right: afterBox.left };
    const written = new WeakMap<SVGGElement, string>();
    let shown = new Set<number>();
    let frameId: number | null = null;

    const draw = (position: number, panes: Record<Side, PaneFrame>) => {
      const item = layout.items[position];
      const group = groups.current.get(item.changeId);
      if (!group) return;
      const frame = connectorFrameOf({
        item,
        panes,
        gutter,
        clampInset: CONNECTOR_STYLE.CLAMP_INSET_PX,
        chevronSize: CONNECTOR_STYLE.CHEVRON_PX
      });
      const key = frameKey(frame);
      if (written.get(group) === key) return;
      written.set(group, key);
      writeFrame(group, frame);
      if (frame.state === CONNECTOR_STATE.HIDDEN) onHidden(item.changeId);
    };

    const update = () => {
      frameId = null;
      const panes = {
        [COMPARE_SIDE.BEFORE]: paneFrameOf(beforeBox, before),
        [COMPARE_SIDE.AFTER]: paneFrameOf(afterBox, after)
      };
      const candidates = new Set([
        ...candidatesOf({
          index: layout.index.before,
          view: {
            top: panes.before.scrollTop,
            bottom: panes.before.scrollTop + panes.before.height
          }
        }),
        ...candidatesOf({
          index: layout.index.after,
          view: {
            top: panes.after.scrollTop,
            bottom: panes.after.scrollTop + panes.after.height
          }
        })
      ]);
      // 지난 프레임에 그렸지만 이번에 후보가 아니면(두 끝 모두 멀어졌다) 숨긴다.
      shown.forEach((position) => {
        if (!candidates.has(position)) draw(position, panes);
      });
      candidates.forEach((position) => draw(position, panes));
      shown = candidates;
    };
    const schedule = () => {
      if (frameId === null) frameId = requestAnimationFrame(update);
    };

    // 처음에는 모든 연결선을 한 번 그린다(후보가 아닌 것은 숨김으로).
    layout.items.forEach((_item, position) => shown.add(position));
    update();
    before.addEventListener("scroll", schedule, { passive: true });
    after.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      before.removeEventListener("scroll", schedule);
      after.removeEventListener("scroll", schedule);
    };
  }, [layout, before, after, paneBoxes, groups, onHidden]);
}
