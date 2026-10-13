import type { TextBox } from "@/renderer/shared/api/bindings";
import type { PageGeometry } from "@/renderer/shared/lib/pdfjs";
import type { ConnectorStem } from "./connector-stems";

/** 두 끝점 높이 차이가 이 값(px) 이하면 곡선 대신 직선이다(계획서 §7.1). */
const STRAIGHT_MAX_RISE_PX = 3;
/** 좌표를 소수 둘째 자리로 반올림한다(부동소수점 잡음으로 path 문자열이 바뀌어 다시 그리지 않게). */
const COORDINATE_SCALE = 100;
const HALF = 0.5;

/** 연결선 한쪽 끝의 쪽: 배율 1 화면 변환과 그 쪽이 화면에 놓인 높이(px) */
export interface ConnectorEnd {
  geometry: PageGeometry;
  heightPx: number;
}

function rounded(value: number): number {
  return Math.round(value * COORDINATE_SCALE) / COORDINATE_SCALE;
}

interface CenterParams {
  box: TextBox;
  end: ConnectorEnd;
}

/**
 * 묶음 상자의 세로 가운데(쪽 위 끝에서 px). 상자를 그 쪽 pdf.js viewport로 바꾼 화면 상자의 세로
 * 가운데이고(ADR 0001 §2, 손 공식 금지), 배율 1 값을 쪽이 놓인 높이에 비율로 맞춘다.
 */
function centerYOf({ box, end }: CenterParams): number {
  const rect = end.geometry.toViewportRect(box);
  return ((rect.top + rect.height * HALF) / end.geometry.height) * end.heightPx;
}

interface ConnectorPathParams {
  stem: ConnectorStem;
  before: ConnectorEnd;
  after: ConnectorEnd;
  /** 거터 너비(px). SVG가 거터에 정확히 놓이므로 x는 0과 이 값이다. */
  widthPx: number;
}

/**
 * 거터를 가로지르는 연결선 path(계획서 §7.1). 3차 베지어 `(0, aY) → (W, bY)`, 제어점 `(W/2, aY)`·
 * `(W/2, bY)`(양끝에서 수평으로 나가는 대칭 S). 높이 차이가 3px 이하면 직선이다.
 */
export function connectorPathOf({
  stem,
  before,
  after,
  widthPx
}: ConnectorPathParams): string {
  const startY = rounded(centerYOf({ box: stem.before, end: before }));
  const endY = rounded(centerYOf({ box: stem.after, end: after }));
  const width = rounded(widthPx);
  if (Math.abs(startY - endY) <= STRAIGHT_MAX_RISE_PX) {
    return `M0 ${startY} L${width} ${endY}`;
  }
  const middle = rounded(width * HALF);
  return `M0 ${startY} C${middle} ${startY} ${middle} ${endY} ${width} ${endY}`;
}
