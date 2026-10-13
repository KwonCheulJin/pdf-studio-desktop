import {
  CHANGE_KIND_STYLE,
  ChangeHighlight,
  ChangeNumberTag,
  type PageHighlight,
  type Side
} from "@/renderer/entities/comparison";
import type { PageGeometry } from "@/renderer/shared/lib/pdfjs";
import { cn } from "@/renderer/shared/lib/utils";
import { ROW_BAND_STYLE } from "../config/viewer-layout";
import { visibleTagIdsOf } from "../lib/number-tag-layout";
import type { RowBand } from "../lib/row-bands";

const PERCENT = 100;

interface RowBandPathProps {
  band: RowBand;
  geometry: PageGeometry;
  side: Side;
  isEmphasized: boolean;
}

/**
 * 연결선 끝의 줄 표시(계획서 §7.1 Step 28-d): 쪽 너비 전체 × 끝 사각형(상자 합집합 또는 앵커 막대)의 세로
 * 범위. 높이 0(90·270도 쪽 앵커)도 선으로 보이도록 사각형 대신 닫힌 경로로 그린다.
 */
function RowBandPath({ band, geometry, side, isEmphasized }: RowBandPathProps) {
  const rect = geometry.toViewportRect(band.bounds);
  const style = CHANGE_KIND_STYLE[band.kind];
  return (
    <path
      data-row-band=""
      data-change-id={band.changeId}
      data-side={side}
      data-kind={band.kind}
      data-emphasized={isEmphasized || undefined}
      d={`M0 ${rect.top} H${geometry.width} V${rect.top + rect.height} H0 Z`}
      className={cn(style.fill, style.stroke)}
      fillOpacity={ROW_BAND_STYLE.FILL_OPACITY}
      strokeWidth={
        isEmphasized
          ? ROW_BAND_STYLE.EMPHASIZED_STROKE_PX
          : ROW_BAND_STYLE.STROKE_PX
      }
      vectorEffect="non-scaling-stroke"
    />
  );
}

interface HighlightOverlayProps {
  geometry: PageGeometry;
  highlights: readonly PageHighlight[];
  /** 연결선 끝의 줄 표시(연결선이 꺼져 있으면 비어 있다). 변경 상자 아래에 그린다. */
  rowBands: readonly RowBand[];
  side: Side;
  activeChangeId: string | null;
  /** 연결선을 가리켜 함께 강조할 변경 */
  hoveredChangeId: string | null;
  /** 쪽이 화면에 놓인 너비(px). 고리 간격과 번호 태그 겹침을 화면 px로 본다. */
  widthPx: number;
}

/**
 * 쪽 위 SVG 하이라이트·연결선 줄 표시와 번호 태그. 줄 표시는 쪽과 함께 스크롤되도록 공용 연결선 오버레이가
 * 아니라 여기(쪽 위)에 두고, 변경 상자보다 먼저 그려 상자가 그 위에 보이게 한다. Rust가 준 PDF 좌표를 그 쪽의 배율 1 pdf.js viewport로 바꾸고
 * (`convertToViewportRectangle`, ADR 0001 §2), SVG `viewBox`를 그 viewport 크기로 두어 쪽 크기에
 * 맞춘다. 원점·회전·`UserUnit`을 손으로 보정하지 않는다. 번호 태그는 겹치면 뒤 번호를 뺀다.
 */
export function HighlightOverlay({
  geometry,
  highlights,
  rowBands,
  side,
  activeChangeId,
  hoveredChangeId,
  widthPx
}: HighlightOverlayProps) {
  const unitsPerPixel = widthPx > 0 ? geometry.width / widthPx : 0;
  const pixelsPerUnit = unitsPerPixel > 0 ? 1 / unitsPerPixel : 0;
  // 고른 변경을 마지막에 그려 고리가 다른 상자 위에 오게 한다.
  const placed = highlights
    .map((highlight) => ({
      highlight,
      rect: geometry.toViewportRect(highlight.box),
      isActive: highlight.changeId === activeChangeId
    }))
    .sort((first, second) => Number(first.isActive) - Number(second.isActive));
  const tagged = placed.filter(({ highlight }) => highlight.isFirstOnPage);
  const visibleTagIds = visibleTagIdsOf(
    tagged.map(({ highlight, rect, isActive }) => ({
      changeId: highlight.changeId,
      number: highlight.number,
      rightPx: (rect.left + rect.width) * pixelsPerUnit,
      topPx: rect.top * pixelsPerUnit,
      isActive
    }))
  );

  return (
    <>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {rowBands.map((band) => (
          <RowBandPath
            key={band.changeId}
            band={band}
            geometry={geometry}
            side={side}
            isEmphasized={
              band.changeId === activeChangeId ||
              band.changeId === hoveredChangeId
            }
          />
        ))}
        {placed.map(({ highlight, rect, isActive }) => (
          <ChangeHighlight
            key={`${highlight.changeId}:${highlight.box.x}:${highlight.box.y}`}
            rect={rect}
            changeId={highlight.changeId}
            side={side}
            kind={highlight.kind}
            needsReview={highlight.needsReview}
            isActive={isActive}
            isHovered={highlight.changeId === hoveredChangeId}
            unitsPerPixel={unitsPerPixel}
          />
        ))}
      </svg>
      {tagged
        .filter(({ highlight }) => visibleTagIds.has(highlight.changeId))
        .map(({ highlight, rect }) => (
          <ChangeNumberTag
            key={highlight.changeId}
            changeId={highlight.changeId}
            number={highlight.number}
            kind={highlight.kind}
            needsReview={highlight.needsReview}
            leftPercent={((rect.left + rect.width) / geometry.width) * PERCENT}
            topPercent={(rect.top / geometry.height) * PERCENT}
          />
        ))}
    </>
  );
}
