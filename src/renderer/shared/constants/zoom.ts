/**
 * Zoom(카드 최소 열 너비) 설정 상수. 기본값이 시안 2의 열 180px(100%)이고 막대 가운데다.
 */
export const ZOOM_CONFIG = {
  /** 최소 열 너비 하한 (px) */
  MIN_CARD_SIZE: 140,
  /** 최소 열 너비 상한 (px) */
  MAX_CARD_SIZE: 220,
  /** 기본 최소 열 너비 (px) */
  DEFAULT_CARD_SIZE: 180,
  /** Zoom In/Out 단계 (px) */
  STEP: 20
} as const;
