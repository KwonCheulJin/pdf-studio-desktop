import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  CHANGE_KIND_STYLE,
  CONNECTOR_SHAPE
} from "@/renderer/entities/comparison";
import {
  useChangeHoverStore,
  useHoveredChangeId,
  useSelectChange
} from "@/renderer/features/pdf-compare";
import { cn } from "@/renderer/shared/lib/utils";
import { CONNECTOR_STYLE } from "../config/viewer-layout";
import type { ConnectorLayoutItem } from "../lib/connector-geometry";
import {
  CONNECTOR_PART,
  useConnectorFrames
} from "../model/use-connector-frames";
import type { ConnectorLayout } from "../model/use-connector-layout";
import type { PaneBoxes, PaneScrollers } from "../model/use-pane-boxes";

interface ConnectorGroupProps {
  item: ConnectorLayoutItem;
  isEmphasized: boolean;
  groups: RefObject<Map<string, SVGGElement>>;
  onHover: (changeId: string) => void;
  onLeave: (changeId: string) => void;
  onSelect: (changeId: string) => void;
}

/**
 * 변경 하나의 연결선. 경로의 `d`와 상태(`data-state` 등)는 프레임마다 `useConnectorFrames`가 DOM에 바로
 * 쓰고, React는 모양·색·강조만 정한다. 마우스는 거터 구간의 투명한 경로(`hit`)가 받는다(쪽·스크롤바
 * 위의 조작을 가리지 않는다).
 */
function ConnectorGroup({
  item,
  isEmphasized,
  groups,
  onHover,
  onLeave,
  onSelect
}: ConnectorGroupProps) {
  const style = CHANGE_KIND_STYLE[item.kind];
  const { changeId } = item;
  const registerGroup = useCallback(
    (element: SVGGElement | null) => {
      if (!element) return;
      groups.current.set(changeId, element);
      return () => {
        groups.current.delete(changeId);
      };
    },
    [groups, changeId]
  );
  return (
    <g
      ref={registerGroup}
      data-change-id={changeId}
      data-kind={item.kind}
      data-shape={item.shape}
      data-emphasized={isEmphasized || undefined}
    >
      {item.shape === CONNECTOR_SHAPE.BAND && (
        <path
          data-part={CONNECTOR_PART.BAND}
          className={cn(style.fill, style.stroke)}
          strokeWidth={
            isEmphasized
              ? CONNECTOR_STYLE.EMPHASIZED_BAND_STROKE_PX
              : CONNECTOR_STYLE.BAND_STROKE_PX
          }
          strokeLinejoin="round"
        />
      )}
      <path
        data-part={CONNECTOR_PART.LINE}
        fill="none"
        className={style.stroke}
        strokeWidth={
          isEmphasized
            ? CONNECTOR_STYLE.EMPHASIZED_STROKE_PX
            : CONNECTOR_STYLE.STROKE_PX
        }
        strokeLinecap="round"
      />
      <path
        data-part={CONNECTOR_PART.MARKER}
        fill="none"
        className={style.stroke}
        strokeWidth={CONNECTOR_STYLE.STROKE_PX}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        data-part={CONNECTOR_PART.HIT}
        stroke="transparent"
        strokeWidth={CONNECTOR_STYLE.HIT_STROKE_PX}
        pointerEvents="visiblePainted"
        className="cursor-pointer"
        onPointerEnter={() => onHover(changeId)}
        onPointerLeave={() => onLeave(changeId)}
        onClick={() => onSelect(changeId)}
      />
    </g>
  );
}

/** 그 변경을 가리키고 있으면 호버를 푼다(선이 사라져 포인터가 떠날 기회가 없을 때). */
function clearHoverOf(changeId: string): void {
  const { hoveredChangeId, setHoveredChangeId } =
    useChangeHoverStore.getState();
  if (hoveredChangeId === changeId) setHoveredChangeId(null);
}

interface ConnectorOverlayProps {
  layout: ConnectorLayout;
  scrollers: PaneScrollers;
  paneBoxes: PaneBoxes | null;
  activeChangeId: string | null;
}

/**
 * 비교 영역(A 패널 + 거터 + B 패널) 전체를 덮는 SVG 한 장의 연결선(계획서 §7.1). 변경마다 `<g>` 하나를 두고,
 * 보이는지·경로는 스크롤 프레임마다 DOM에 바로 쓴다. 가리키면(hover) 그 선이 굵어지고 양쪽 상자·목록
 * 항목을 함께 강조하며, 누르면 그 변경을 골라 목록과 두 패널을 그 자리로 옮긴다.
 */
export function ConnectorOverlay({
  layout,
  scrollers,
  paneBoxes,
  activeChangeId
}: ConnectorOverlayProps) {
  const groups = useRef(new Map<string, SVGGElement>());
  const hoveredChangeId = useHoveredChangeId();
  const setHoveredChangeId = useChangeHoverStore(
    (state) => state.setHoveredChangeId
  );
  const selectChange = useSelectChange();

  useConnectorFrames({
    layout,
    scrollers,
    paneBoxes,
    groups,
    onHidden: clearHoverOf
  });

  // 연결선이 바뀌거나 사라지면(필터·연결선 끔·보기 방식) 가리키던 선의 강조를 푼다(외부 스토어 정리).
  useEffect(
    () => () => {
      layout.items.forEach(({ changeId }) => clearHoverOf(changeId));
    },
    [layout]
  );

  return (
    <svg
      aria-hidden="true"
      data-connector-layer=""
      className="pointer-events-none absolute inset-0 size-full overflow-hidden"
    >
      {layout.items.map((item) => (
        <ConnectorGroup
          key={item.changeId}
          item={item}
          isEmphasized={
            item.changeId === hoveredChangeId ||
            item.changeId === activeChangeId
          }
          groups={groups}
          onHover={setHoveredChangeId}
          onLeave={clearHoverOf}
          onSelect={selectChange}
        />
      ))}
    </svg>
  );
}
