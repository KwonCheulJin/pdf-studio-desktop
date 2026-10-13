/**
 * 카드 그리드 설정(시안 2: `repeat(auto-fill, minmax(180px, 1fr))`, 간격·여백 24px).
 * 열 수는 최소 열 너비(확대 막대 값)로 정하고, 카드는 남는 폭을 나눠 가로를 채운다.
 */
export const GRID_CONFIG = {
  /** 최소 열 너비의 하한 (px) */
  MIN_CARD_SIZE: 140,
  /** 최소 열 너비의 상한 (px) */
  MAX_CARD_SIZE: 220,
  /** 카드 간 간격 (px) */
  GAP: 24,
  /** 컨테이너 여백 (px) */
  PADDING: 24,
  /** 드롭 시 갭 확장량 (px). 간격과 같게 두어 줄 끝 카드가 여백 밖으로 나가지 않는다. */
  EXPANSION_OFFSET: 24,
  /** 썸네일(종이) 높이 / 최소 열 너비. 시안의 열 180px에 종이 220px */
  THUMBNAIL_HEIGHT_RATIO: 220 / 180,
  /** 종이 안 페이지 이미지 여백 (px). 회전해도 종이 안에 들도록 정사각형 상자에 그린다. */
  IMAGE_PADDING: 16,
  /** 푸터 높이 - 위 여백 12 + 파일명 21 + 간격 2 + 쪽수 17 (px) */
  FOOTER_HEIGHT: 52,
  /** 삽입선 위치 보정 오프셋 (px) */
  INSERTION_LINE_OFFSET: 2,
  /** 드롭존 인디케이터 위치 보정 오프셋 (px) */
  DROP_INDICATOR_OFFSET: 4
} as const;
