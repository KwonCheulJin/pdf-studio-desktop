import {
  ChangeHighlight,
  ChangeNumberTag,
  type PageHighlight,
  type Side
} from "@/renderer/entities/comparison";
import type { PageGeometry } from "@/renderer/shared/lib/pdfjs";

const PERCENT = 100;

interface HighlightOverlayProps {
  geometry: PageGeometry;
  highlights: readonly PageHighlight[];
  side: Side;
  activeChangeId: string | null;
  /** 쪽이 화면에 놓인 너비(px). 고리 간격을 화면 px로 맞춘다. */
  widthPx: number;
}

/**
 * 쪽 위 SVG 하이라이트와 번호 태그. Rust가 준 PDF 좌표를 그 쪽의 배율 1 pdf.js viewport로 바꾸고
 * (`convertToViewportRectangle`, ADR 0001 §2), SVG `viewBox`를 그 viewport 크기로 두어 쪽 크기에
 * 맞춘다. 원점·회전·`UserUnit`을 손으로 보정하지 않는다.
 */
export function HighlightOverlay({
  geometry,
  highlights,
  side,
  activeChangeId,
  widthPx
}: HighlightOverlayProps) {
  const unitsPerPixel = widthPx > 0 ? geometry.width / widthPx : 0;
  // 고른 변경을 마지막에 그려 고리가 다른 상자 위에 오게 한다.
  const placed = highlights
    .map((highlight) => ({
      highlight,
      rect: geometry.toViewportRect(highlight.box),
      isActive: highlight.changeId === activeChangeId
    }))
    .sort((first, second) => Number(first.isActive) - Number(second.isActive));

  return (
    <>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {placed.map(({ highlight, rect, isActive }) => (
          <ChangeHighlight
            key={`${highlight.changeId}:${highlight.box.x}:${highlight.box.y}`}
            rect={rect}
            changeId={highlight.changeId}
            side={side}
            kind={highlight.kind}
            needsReview={highlight.needsReview}
            isActive={isActive}
            unitsPerPixel={unitsPerPixel}
          />
        ))}
      </svg>
      {placed
        .filter(({ highlight }) => highlight.isFirstOnPage)
        .map(({ highlight, rect }) => (
          <ChangeNumberTag
            key={highlight.changeId}
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
