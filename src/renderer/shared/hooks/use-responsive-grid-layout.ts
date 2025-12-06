import { useMemo } from "react";
import { GRID_CONFIG } from "@/renderer/shared/constants/grid-layout";

interface GridPosition {
  x: number;
  y: number;
}

interface ResponsiveGridLayout {
  /** 열 수 */
  columns: number;
  /** 카드(썸네일) 크기 - 정사각형 */
  cardSize: number;
  /** 전체 카드 높이 (썸네일 + 푸터) */
  cardHeight: number;
  /** 실제 이미지 크기 */
  imageSize: number;
  /** 각 카드의 절대 좌표 */
  positions: GridPosition[];
  /** 컨테이너 전체 높이 */
  containerHeight: number;
}

interface UseResponsiveGridLayoutParams {
  itemsCount: number;
  viewportWidth: number;
  activeDropIndex?: number | null;
  /** 사용자 지정 카드 크기 (Zoom 기능) */
  userCardSize?: number;
}

/**
 * Adobe Acrobat 스타일 반응형 그리드 레이아웃 계산 훅
 *
 * @param params - 레이아웃 파라미터
 * @returns ResponsiveGridLayout
 */
export function useResponsiveGridLayout({
  itemsCount,
  viewportWidth,
  activeDropIndex,
  userCardSize
}: UseResponsiveGridLayoutParams): ResponsiveGridLayout {
  const {
    MIN_CARD_SIZE,
    MAX_CARD_SIZE,
    GAP,
    PADDING,
    EXPANSION_OFFSET,
    FOOTER_HEIGHT,
    IMAGE_PADDING
  } = GRID_CONFIG;

  return useMemo(() => {
    const availableWidth = viewportWidth - PADDING * 2;

    // userCardSize가 있으면 사용, 없으면 자동 계산
    let cardSize: number;
    let columns: number;

    if (userCardSize) {
      // Zoom 모드: 사용자 지정 카드 크기 사용
      cardSize = Math.max(MIN_CARD_SIZE, Math.min(MAX_CARD_SIZE, userCardSize));
      columns = Math.max(
        1,
        Math.floor((availableWidth + GAP) / (cardSize + GAP))
      );
    } else {
      // 자동 모드: 뷰포트에 맞게 카드 크기 계산
      columns = Math.max(
        1,
        Math.floor((availableWidth + GAP) / (MIN_CARD_SIZE + GAP))
      );
      cardSize = Math.min(
        MAX_CARD_SIZE,
        Math.floor((availableWidth - GAP * (columns - 1)) / columns)
      );
    }

    const cardHeight = cardSize + FOOTER_HEIGHT;
    const imageSize = cardSize - IMAGE_PADDING;

    // 실제 그리드 폭 계산 (카드들 + 간격)
    const actualGridWidth = columns * cardSize + (columns - 1) * GAP;
    // 남는 공간을 양쪽에 균등 분배하여 중앙 정렬
    const horizontalOffset = Math.max(PADDING, (viewportWidth - actualGridWidth) / 2);

    // 기본 위치 계산 (중앙 정렬)
    let positions: GridPosition[] = Array.from(
      { length: itemsCount },
      (_, idx) => ({
        x: horizontalOffset + (idx % columns) * (cardSize + GAP),
        y: PADDING + Math.floor(idx / columns) * (cardHeight + GAP)
      })
    );

    // 갭 확장 오프셋 적용 (드롭 활성 시)
    if (activeDropIndex !== null && activeDropIndex !== undefined) {
      const activeRow = Math.floor(activeDropIndex / columns);
      positions = positions.map((pos, idx) => {
        const row = Math.floor(idx / columns);
        // 같은 행에서 드롭 인덱스 이후 카드들을 오른쪽으로 이동
        if (row === activeRow && idx >= activeDropIndex) {
          return { ...pos, x: pos.x + EXPANSION_OFFSET };
        }
        return pos;
      });
    }

    // 컨테이너 높이 계산
    const rows = Math.ceil(itemsCount / columns);
    const containerHeight =
      rows > 0 ? PADDING * 2 + rows * (cardHeight + GAP) - GAP : PADDING * 2;

    return {
      columns,
      cardSize,
      cardHeight,
      imageSize,
      positions,
      containerHeight
    };
  }, [
    itemsCount,
    viewportWidth,
    activeDropIndex,
    userCardSize,
    MIN_CARD_SIZE,
    MAX_CARD_SIZE,
    GAP,
    PADDING,
    EXPANSION_OFFSET,
    FOOTER_HEIGHT,
    IMAGE_PADDING
  ]);
}
