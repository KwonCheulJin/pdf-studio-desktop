export interface LayoutPosition {
  x: number;
  y: number;
}

interface GetDropZonePositionParams {
  index: number;
  positions: LayoutPosition[];
  flatCardsLength: number;
  cardSize: number;
  gap: number;
  padding: number;
}

/**
 * ReorderDropZone 위치 계산 (gap + 카드 왼쪽 절반 영역)
 *
 * @param params 위치 계산에 필요한 파라미터
 * @returns 드롭존 위치 좌표
 */
export function getDropZonePosition({
  index,
  positions,
  flatCardsLength,
  cardSize,
  gap,
  padding
}: GetDropZonePositionParams): LayoutPosition {
  // 첫 번째 카드: 컨테이너 왼쪽 끝(x=0)부터 시작하여 히트 영역 확장
  if (index === 0) {
    const cardPosition = positions[0];
    if (cardPosition) {
      return { x: 0, y: cardPosition.y };
    }
    return { x: 0, y: padding };
  }

  // 마지막 드롭존: 마지막 카드 오른쪽 절반
  if (index >= flatCardsLength) {
    const lastPosition = positions[flatCardsLength - 1];
    if (lastPosition) {
      return { x: lastPosition.x + cardSize / 2, y: lastPosition.y };
    }
    return { x: padding, y: padding };
  }

  // 나머지 카드: gap 영역부터 시작 (떨림 방지)
  const cardPosition = positions[index];
  if (cardPosition) {
    return { x: cardPosition.x - gap, y: cardPosition.y };
  }
  return { x: padding, y: padding };
}

interface GetDropZoneWidthParams {
  index: number;
  cardSize: number;
  gap: number;
  flatCardsLength: number;
}

/**
 * 드롭존 폭 계산 (첫 번째 카드는 gap 없음)
 *
 * @param params 폭 계산에 필요한 파라미터
 * @returns 드롭존 폭 (px)
 */
export function getDropZoneWidth({
  index,
  cardSize,
  gap,
  flatCardsLength
}: GetDropZoneWidthParams): number {
  // 첫 번째 카드: gap + 카드 왼쪽 절반 (다른 카드와 동일한 폭으로 히트 영역 확장)
  if (index === 0) {
    return gap + cardSize / 2;
  }
  // 마지막 드롭존: 카드 오른쪽 절반 + gap (첫 번째와 동일하게 확장)
  if (index >= flatCardsLength) {
    return cardSize / 2 + gap;
  }
  // 나머지: gap + 카드 왼쪽 절반
  return gap + cardSize / 2;
}

interface GetInsertionLinePositionParams {
  index: number;
  positions: LayoutPosition[];
  flatCardsLength: number;
  cardSize: number;
  gap: number;
  padding: number;
  insertionLineOffset: number;
}

/**
 * 삽입선 위치 계산 (카드 왼쪽 가장자리)
 *
 * @param params 위치 계산에 필요한 파라미터
 * @returns 삽입선 위치 좌표
 */
export function getInsertionLinePosition({
  index,
  positions,
  flatCardsLength,
  cardSize,
  gap,
  padding,
  insertionLineOffset
}: GetInsertionLinePositionParams): LayoutPosition {
  if (index >= flatCardsLength) {
    // 마지막 위치: 마지막 카드 오른쪽 가장자리
    const lastPosition = positions[flatCardsLength - 1];
    if (lastPosition) {
      return {
        x: lastPosition.x + cardSize + gap / 2 - insertionLineOffset,
        y: lastPosition.y
      };
    }
    return { x: padding, y: padding };
  }

  // 해당 인덱스 카드의 왼쪽 가장자리
  const cardPosition = positions[index];
  if (cardPosition) {
    return {
      x: cardPosition.x - gap / 2 - insertionLineOffset,
      y: cardPosition.y
    };
  }
  return { x: padding, y: padding };
}
