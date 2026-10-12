export interface GridPosition {
  x: number;
  y: number;
}

interface CalculateDropIndexParams {
  /** 그리드 컨테이너 왼쪽 위 기준 좌표 */
  point: GridPosition;
  /** 카드 왼쪽 위 좌표. 행 우선 순서(왼쪽 → 오른쪽, 위 → 아래) */
  positions: GridPosition[];
  cardWidth: number;
  cardHeight: number;
  /** 카드 사이 간격. 행 사이 간격의 위쪽 절반은 위 행으로 친다. */
  gap: number;
}

/**
 * 좌표에 놓으면 몇 번째 카드 앞에 들어가는지 계산한다.
 * 좌표가 든 행에서 가운데가 좌표보다 오른쪽에 있는 첫 카드 앞이고,
 * 그런 카드가 없으면 그 행의 마지막 카드 뒤다. 모든 행보다 아래면 맨 끝(`positions.length`)이다.
 */
export function calculateDropIndex({
  point,
  positions,
  cardWidth,
  cardHeight,
  gap
}: CalculateDropIndexParams): number {
  const rowStart = positions.findIndex(
    (position) => point.y < position.y + cardHeight + gap / 2
  );
  if (rowStart === -1) {
    return positions.length;
  }
  const rowY = positions[rowStart].y;
  const isInRow = (position: GridPosition, index: number): boolean =>
    index >= rowStart && position.y === rowY;

  const before = positions.findIndex(
    (position, index) =>
      isInRow(position, index) && point.x < position.x + cardWidth / 2
  );
  if (before !== -1) {
    return before;
  }
  const nextRowStart = positions.findIndex(
    (position, index) => index >= rowStart && !isInRow(position, index)
  );
  return nextRowStart === -1 ? positions.length : nextRowStart;
}
