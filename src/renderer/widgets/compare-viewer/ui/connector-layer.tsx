import { useEffect, useMemo } from "react";
import {
  CHANGE_KIND_STYLE,
  connectorPathOf,
  type ConnectorStem
} from "@/renderer/entities/comparison";
import {
  useChangeHoverStore,
  useHoveredChangeIds
} from "@/renderer/features/pdf-compare";
import { usePageGeometry } from "@/renderer/shared/lib/pdfjs";
import { CONNECTOR_STROKE_PX } from "../config/viewer-layout";

/** 묶음 키(`data-change-ids`): 묶음 안 변경 id를 A 읽는 순서로 공백 하나로 잇는다. */
function stemKeyOf(stem: ConnectorStem): string {
  return stem.changeIds.join(" ");
}

export interface ConnectorPage {
  path: string;
  page: number;
  /** 쪽이 화면에 놓인 높이(px) */
  heightPx: number;
}

interface ConnectorLayerProps {
  stems: readonly ConnectorStem[];
  before: ConnectorPage;
  after: ConnectorPage;
  /** 거터 너비·높이(px). 높이는 두 쪽 중 큰 쪽이다. */
  widthPx: number;
  heightPx: number;
  activeChangeId: string | null;
}

/**
 * 행 하나의 거터 연결선(계획서 §7.1). SVG 하나를 거터에 정확히 겹치고(x는 0과 너비) 묶음마다 `<g>`에
 * 마우스를 받는 투명한 넓은 선과 보이는 선을 둔다. 끝점은 묶음 상자를 그 쪽 pdf.js viewport로 바꾼
 * 상자의 세로 가운데다. 평상시는 중립색 45%, 묶음 안 변경을 고르거나 선을 가리키면 그 종류 색으로
 * 굵어진다. 가리키면 묶음의 변경을 페이지·목록에서 함께 강조한다. 스크롤하는 동안(`data-scrolling`)은
 * 숨긴다.
 */
export function ConnectorLayer({
  stems,
  before,
  after,
  widthPx,
  heightPx,
  activeChangeId
}: ConnectorLayerProps) {
  const beforeGeometry = usePageGeometry({
    path: before.path,
    pageIndex: before.page,
    isEnabled: true
  });
  const afterGeometry = usePageGeometry({
    path: after.path,
    pageIndex: after.page,
    isEnabled: true
  });
  const hoveredChangeIds = useHoveredChangeIds();
  const setHoveredChangeIds = useChangeHoverStore(
    (state) => state.setHoveredChangeIds
  );

  const drawn = useMemo(() => {
    if (!beforeGeometry || !afterGeometry) return [];
    return stems.map((stem) => ({
      stem,
      key: stemKeyOf(stem),
      path: connectorPathOf({
        stem,
        before: { geometry: beforeGeometry, heightPx: before.heightPx },
        after: { geometry: afterGeometry, heightPx: after.heightPx },
        widthPx
      })
    }));
  }, [
    stems,
    beforeGeometry,
    afterGeometry,
    before.heightPx,
    after.heightPx,
    widthPx
  ]);

  // 가리키던 행이 화면 밖으로 나가 사라지면 그 묶음 강조를 푼다(외부 스토어 정리).
  useEffect(
    () => () => {
      const { hoveredChangeIds: current, setHoveredChangeIds: clear } =
        useChangeHoverStore.getState();
      const isMine = stems.some((stem) =>
        stem.changeIds.some((id) => current.includes(id))
      );
      if (isMine) clear([]);
    },
    [stems]
  );

  return (
    <svg
      aria-hidden="true"
      data-connector-layer=""
      width={widthPx}
      height={heightPx}
      viewBox={`0 0 ${widthPx} ${heightPx}`}
      className="pointer-events-none absolute inset-0 overflow-visible transition-opacity duration-140 in-data-scrolling:opacity-0"
    >
      {drawn.map(({ stem, key, path }) => {
        const isEmphasized =
          stem.changeIds.some((id) => hoveredChangeIds.includes(id)) ||
          (activeChangeId !== null && stem.changeIds.includes(activeChangeId));
        const emphasisClass = stem.kind
          ? CHANGE_KIND_STYLE[stem.kind].stroke
          : "stroke-connector";
        return (
          <g
            key={key}
            data-change-ids={key}
            data-emphasized={isEmphasized || undefined}
          >
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={CONNECTOR_STROKE_PX.HIT}
              pointerEvents="stroke"
              onPointerEnter={() => setHoveredChangeIds(stem.changeIds)}
              onPointerLeave={() => setHoveredChangeIds([])}
            />
            <path
              d={path}
              fill="none"
              strokeLinecap="round"
              strokeWidth={
                isEmphasized
                  ? CONNECTOR_STROKE_PX.EMPHASIZED
                  : CONNECTOR_STROKE_PX.NORMAL
              }
              className={isEmphasized ? emphasisClass : "stroke-connector/45"}
            />
          </g>
        );
      })}
    </svg>
  );
}
