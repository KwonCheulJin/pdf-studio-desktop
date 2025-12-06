/**
 * Adobe Acrobat 스타일 반응형 그리드 설정
 * 화면 너비에 따라 카드 크기 동적 조정
 */
export const GRID_CONFIG = {
  /** 최소 카드(썸네일) 크기 (px) */
  MIN_CARD_SIZE: 200,
  /** 최대 카드(썸네일) 크기 (px) */
  MAX_CARD_SIZE: 280,
  /** 카드 간 간격 - grid-item-indicator (px) */
  GAP: 32,
  /** 컨테이너 좌우 패딩 (px) */
  PADDING: 24,
  /** 드롭 시 갭 확장량 (px) */
  EXPANSION_OFFSET: 32,
  /** 카드 내 이미지 패딩 (px) - 썸네일과 이미지 사이 여백 */
  IMAGE_PADDING: 40,
  /** 푸터 높이 - 파일명 + 페이지 정보 영역 (px) */
  FOOTER_HEIGHT: 56,
  /** 삽입선 위치 보정 오프셋 (px) */
  INSERTION_LINE_OFFSET: 2,
  /** 드롭존 인디케이터 위치 보정 오프셋 (px) */
  DROP_INDICATOR_OFFSET: 4
} as const;

/**
 * 절대 좌표 기반 카드 그리드 레이아웃 상수
 * @deprecated GRID_CONFIG 사용 권장
 */
export const GRID_LAYOUT = {
  /** 카드 폭 (px) */
  CARD_W: 231,
  /** 카드 높이 - 썸네일 + 푸터 (px) */
  CARD_H: 287,
  /** 카드 간 간격 (px) */
  GAP: 40,
  /** 컨테이너 패딩 (px) */
  PADDING: 24,
  /** 드롭 인디케이터 폭 (px) */
  DROPZONE_W: 8
} as const;
