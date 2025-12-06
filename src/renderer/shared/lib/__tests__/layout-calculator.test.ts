import { describe, it, expect } from "vitest";
import {
  getDropZonePosition,
  getDropZoneWidth,
  getInsertionLinePosition
} from "../layout-calculator";

// 테스트용 위치 배열 생성 헬퍼
function createPositions(
  count: number,
  cardSize: number,
  columns: number,
  gap: number,
  padding: number
): Array<{ x: number; y: number }> {
  const cardHeight = cardSize + 56; // FOOTER_HEIGHT
  return Array.from({ length: count }, (_, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    return {
      x: padding + col * (cardSize + gap),
      y: padding + row * (cardHeight + gap)
    };
  });
}

describe("getDropZonePosition", () => {
  const cardSize = 200;
  const cardHeight = 256;
  const gap = 40;
  const padding = 24;
  const columns = 3;
  const flatCardsLength = 6;

  const positions = createPositions(
    flatCardsLength,
    cardSize,
    columns,
    gap,
    padding
  );

  it("첫 번째 인덱스(0)는 첫 번째 카드 위치 반환", () => {
    const result = getDropZonePosition({
      index: 0,
      positions,
      flatCardsLength,
      cardSize,
      gap,
      padding
    });

    expect(result.x).toBe(positions[0].x);
    expect(result.y).toBe(positions[0].y);
  });

  it("중간 인덱스는 gap 영역부터 시작", () => {
    const result = getDropZonePosition({
      index: 2,
      positions,
      flatCardsLength,
      cardSize,
      gap,
      padding
    });

    // 해당 카드 위치에서 gap만큼 뺀 위치
    expect(result.x).toBe(positions[2].x - gap);
    expect(result.y).toBe(positions[2].y);
  });

  it("마지막 인덱스(flatCardsLength)는 마지막 카드 오른쪽 절반", () => {
    const result = getDropZonePosition({
      index: flatCardsLength,
      positions,
      flatCardsLength,
      cardSize,
      gap,
      padding
    });

    const lastPosition = positions[flatCardsLength - 1];
    expect(result.x).toBe(lastPosition.x + cardSize / 2);
    expect(result.y).toBe(lastPosition.y);
  });

  it("positions가 비어있으면 기본 패딩 위치 반환", () => {
    const result = getDropZonePosition({
      index: 0,
      positions: [],
      flatCardsLength: 0,
      cardSize,
      gap,
      padding
    });

    expect(result.x).toBe(padding);
    expect(result.y).toBe(padding);
  });
});

describe("getDropZoneWidth", () => {
  const cardSize = 200;
  const gap = 40;
  const flatCardsLength = 5;

  it("첫 번째 인덱스(0)는 카드 왼쪽 절반만", () => {
    const result = getDropZoneWidth({
      index: 0,
      cardSize,
      gap,
      flatCardsLength
    });

    expect(result).toBe(cardSize / 2);
  });

  it("중간 인덱스는 gap + 카드 왼쪽 절반", () => {
    const result = getDropZoneWidth({
      index: 2,
      cardSize,
      gap,
      flatCardsLength
    });

    expect(result).toBe(gap + cardSize / 2);
  });

  it("마지막 인덱스(flatCardsLength)는 카드 오른쪽 절반만", () => {
    const result = getDropZoneWidth({
      index: flatCardsLength,
      cardSize,
      gap,
      flatCardsLength
    });

    expect(result).toBe(cardSize / 2);
  });
});

describe("getInsertionLinePosition", () => {
  const cardSize = 200;
  const gap = 40;
  const padding = 24;
  const insertionLineOffset = 2;
  const flatCardsLength = 4;

  const positions = createPositions(flatCardsLength, cardSize, 3, gap, padding);

  it("중간 인덱스는 카드 왼쪽 가장자리", () => {
    const result = getInsertionLinePosition({
      index: 2,
      positions,
      flatCardsLength,
      cardSize,
      gap,
      padding,
      insertionLineOffset
    });

    // 해당 카드 위치에서 gap/2 - offset 위치
    expect(result.x).toBe(positions[2].x - gap / 2 - insertionLineOffset);
    expect(result.y).toBe(positions[2].y);
  });

  it("마지막 인덱스(flatCardsLength)는 마지막 카드 오른쪽 가장자리", () => {
    const result = getInsertionLinePosition({
      index: flatCardsLength,
      positions,
      flatCardsLength,
      cardSize,
      gap,
      padding,
      insertionLineOffset
    });

    const lastPosition = positions[flatCardsLength - 1];
    expect(result.x).toBe(
      lastPosition.x + cardSize + gap / 2 - insertionLineOffset
    );
    expect(result.y).toBe(lastPosition.y);
  });

  it("positions가 비어있으면 기본 패딩 위치 반환", () => {
    const result = getInsertionLinePosition({
      index: 0,
      positions: [],
      flatCardsLength: 0,
      cardSize,
      gap,
      padding,
      insertionLineOffset
    });

    expect(result.x).toBe(padding);
    expect(result.y).toBe(padding);
  });
});
