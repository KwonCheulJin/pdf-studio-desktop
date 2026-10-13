import { useMemo } from "react";
import { GRID_CONFIG } from "@/renderer/shared/constants/grid-layout";

interface GridPosition {
  x: number;
  y: number;
}

interface ResponsiveGridLayout {
  /** 열 수 */
  columns: number;
  /** 카드 폭 (남는 폭을 열마다 나눈 값) */
  cardWidth: number;
  /** 전체 카드 높이 (썸네일 + 푸터) */
  cardHeight: number;
  /** 썸네일 안 페이지 이미지 상자 크기 - 정사각형 */
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
  /** 사용자 지정 최소 열 너비 (Zoom 기능) */
  userCardSize?: number;
}

/**
 * 카드 그리드 레이아웃 계산 훅. CSS `repeat(auto-fill, minmax(<최소 열 너비>, 1fr))`처럼
 * 최소 열 너비로 열 수를 정하고 카드가 가로를 채운다. 썸네일 높이는 최소 열 너비에 비례한다.
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
    THUMBNAIL_HEIGHT_RATIO,
    FOOTER_HEIGHT,
    IMAGE_PADDING
  } = GRID_CONFIG;

  return useMemo(() => {
    const availableWidth = viewportWidth - PADDING * 2;
    const minColumnWidth = Math.max(
      MIN_CARD_SIZE,
      Math.min(MAX_CARD_SIZE, userCardSize ?? MIN_CARD_SIZE)
    );

    const columns = Math.max(
      1,
      Math.floor((availableWidth + GAP) / (minColumnWidth + GAP))
    );
    // minmax(최소, 1fr): 남는 폭을 열마다 나누되 최소 열 너비보다 좁아지지 않는다
    const cardWidth = Math.max(
      minColumnWidth,
      Math.floor((availableWidth - GAP * (columns - 1)) / columns)
    );
    const thumbnailHeight = Math.round(minColumnWidth * THUMBNAIL_HEIGHT_RATIO);
    const cardHeight = thumbnailHeight + FOOTER_HEIGHT;
    const imageSize = Math.min(cardWidth, thumbnailHeight) - IMAGE_PADDING;

    // 기본 위치 계산 (왼쪽부터 채운다)
    let positions: GridPosition[] = Array.from(
      { length: itemsCount },
      (_, index) => ({
        x: PADDING + (index % columns) * (cardWidth + GAP),
        y: PADDING + Math.floor(index / columns) * (cardHeight + GAP)
      })
    );

    // 갭 확장 오프셋 적용 (드롭 활성 시)
    if (activeDropIndex !== null && activeDropIndex !== undefined) {
      const activeRow = Math.floor(activeDropIndex / columns);
      positions = positions.map((position, index) => {
        const row = Math.floor(index / columns);
        // 같은 행에서 드롭 인덱스 이후 카드들을 오른쪽으로 이동
        if (row === activeRow && index >= activeDropIndex) {
          return { ...position, x: position.x + EXPANSION_OFFSET };
        }
        return position;
      });
    }

    // 컨테이너 높이 계산
    const rows = Math.ceil(itemsCount / columns);
    const containerHeight =
      rows > 0 ? PADDING * 2 + rows * (cardHeight + GAP) - GAP : PADDING * 2;

    return {
      columns,
      cardWidth,
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
    THUMBNAIL_HEIGHT_RATIO,
    FOOTER_HEIGHT,
    IMAGE_PADDING
  ]);
}
