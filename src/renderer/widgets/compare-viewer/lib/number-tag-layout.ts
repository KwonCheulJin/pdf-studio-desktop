/**
 * 번호 태그가 쪽 위에 차지하는 크기(px). `ChangeNumberTag`(mono 10/16, 좌우 여백 4px, 상자 오른쪽
 * 6px·위 2px)와 같은 값이다. 숫자 폭은 IBM Plex Mono 한 글자(0.6em = 6px)로 어림한다.
 */
const NUMBER_TAG = {
  HEIGHT_PX: 16,
  PADDING_X_PX: 4,
  DIGIT_WIDTH_PX: 6,
  OFFSET_X_PX: 6,
  OFFSET_Y_PX: 2
} as const;

const PADDING_SIDES = 2;

/** 태그를 달 상자 하나(쪽 그림 위 px, 왼쪽 위 원점) */
export interface TagAnchor {
  changeId: string;
  number: number;
  /** 상자 오른쪽 끝·위 끝 */
  rightPx: number;
  topPx: number;
  isActive: boolean;
}

interface TagRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function tagRectOf({ number, rightPx, topPx }: TagAnchor): TagRect {
  const left = rightPx + NUMBER_TAG.OFFSET_X_PX;
  const top = topPx - NUMBER_TAG.OFFSET_Y_PX;
  const width =
    NUMBER_TAG.PADDING_X_PX * PADDING_SIDES +
    String(number).length * NUMBER_TAG.DIGIT_WIDTH_PX;
  return { left, top, right: left + width, bottom: top + NUMBER_TAG.HEIGHT_PX };
}

function overlaps(first: TagRect, second: TagRect): boolean {
  return (
    first.left < second.right &&
    second.left < first.right &&
    first.top < second.bottom &&
    second.top < first.bottom
  );
}

/**
 * 한 쪽에서 보일 번호 태그(작은 배율에서 태그가 겹쳐 읽을 수 없게 되는 것을 막는다, 토큰 문서 §6.5).
 * 고른 변경의 태그를 먼저, 그다음 번호 순서로 놓으며 이미 놓은 태그와 겹치는 태그는 뺀다. 상자
 * 하이라이트는 그대로 두고 태그만 뺀다. 배율을 키우면 다시 보인다.
 */
export function visibleTagIdsOf(anchors: readonly TagAnchor[]): Set<string> {
  const ordered = [...anchors].sort(
    (first, second) =>
      Number(second.isActive) - Number(first.isActive) ||
      first.number - second.number
  );
  const placed = ordered.reduce<{ ids: string[]; rects: TagRect[] }>(
    (kept, anchor) => {
      const rect = tagRectOf(anchor);
      return kept.rects.some((other) => overlaps(rect, other))
        ? kept
        : { ids: [...kept.ids, anchor.changeId], rects: [...kept.rects, rect] };
    },
    { ids: [], rects: [] }
  );
  return new Set(placed.ids);
}
