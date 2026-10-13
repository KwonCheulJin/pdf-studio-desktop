import type { ChangeKind, Side } from "@/renderer/shared/api/bindings";
import type { ViewportRect } from "@/renderer/shared/lib/pdfjs";
import { cn } from "@/renderer/shared/lib/utils";
import { CHANGE_KIND_STYLE, NEEDS_REVIEW_STYLE } from "../config/change-kind";

/** 상자 테두리 두께(화면 px, 시안 4) */
const BOX_STROKE_PX = 1.5;
/** "확인 필요" 점 고리: 상자 바깥으로 띄우는 간격·두께(화면 px) */
const REVIEW_RING_GAP_PX = 3;
const REVIEW_RING_STROKE_PX = 1.5;
/** 고른 변경 고리: 시안 4 `box-shadow: 0 0 0 3px primary`(상자 바깥 3px) */
const ACTIVE_RING_STROKE_PX = 3;

interface ExpandParams {
  rect: ViewportRect;
  by: number;
}

function expand({ rect, by }: ExpandParams): ViewportRect {
  return {
    left: rect.left - by,
    top: rect.top - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2
  };
}

interface RingProps {
  rect: ViewportRect;
  className: string;
  strokeWidth: number;
  dashArray?: string;
}

function Ring({ rect, className, strokeWidth, dashArray }: RingProps) {
  return (
    <rect
      x={rect.left}
      y={rect.top}
      width={rect.width}
      height={rect.height}
      fill="none"
      className={className}
      strokeWidth={strokeWidth}
      strokeDasharray={dashArray}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

interface ChangeHighlightProps {
  /** 배율 1 viewport 좌표(`PageGeometry.toViewportRect`) */
  rect: ViewportRect;
  changeId: string;
  side: Side;
  kind: ChangeKind;
  needsReview: boolean;
  isActive: boolean;
  /** 이 변경이 든 연결선을 가리키고 있다(고르지 않았으면 옅은 primary 고리) */
  isHovered: boolean;
  /** 화면 1px의 viewport 단위 길이(고리 간격을 화면 px로 맞춘다) */
  unitsPerPixel: number;
}

/**
 * 페이지 위 변경 상자 하나(SVG). 종류 색·선 모양(토큰 문서 §2.1), "확인 필요"는 바깥 점 고리,
 * 고른 변경은 primary 고리를 더한다. 연결선을 가리켜 함께 강조하면(고르지 않은 변경) 같은 자리에
 * 옅은 primary 고리를 둔다. 테두리는 확대와 상관없이 화면 px 두께다.
 */
export function ChangeHighlight({
  rect,
  changeId,
  side,
  kind,
  needsReview,
  isActive,
  isHovered,
  unitsPerPixel
}: ChangeHighlightProps) {
  const style = CHANGE_KIND_STYLE[kind];
  const reviewGap = needsReview ? REVIEW_RING_GAP_PX : 0;
  const isRinged = isActive || isHovered;
  return (
    <g>
      <rect
        data-change-id={changeId}
        data-side={side}
        data-kind={kind}
        data-review={needsReview}
        data-hovered={isHovered || undefined}
        x={rect.left}
        y={rect.top}
        width={rect.width}
        height={rect.height}
        className={cn(style.fill, style.stroke)}
        strokeWidth={BOX_STROKE_PX}
        strokeDasharray={style.dashArray}
        vectorEffect="non-scaling-stroke"
      />
      {needsReview && (
        <Ring
          rect={expand({ rect, by: REVIEW_RING_GAP_PX * unitsPerPixel })}
          className={NEEDS_REVIEW_STYLE.ring}
          strokeWidth={REVIEW_RING_STROKE_PX}
          dashArray={NEEDS_REVIEW_STYLE.ringDashArray}
        />
      )}
      {isRinged && (
        <Ring
          rect={expand({
            rect,
            by: (reviewGap + ACTIVE_RING_STROKE_PX / 2) * unitsPerPixel
          })}
          className={isActive ? "stroke-primary" : "stroke-primary/50"}
          strokeWidth={ACTIVE_RING_STROKE_PX}
        />
      )}
    </g>
  );
}
