/**
 * 슬롯 썸네일(첫 쪽) 렌더 설정. 화면에서는 높이 62px로 줄여 보인다.
 * A4 세로(842pt)를 0.25배로 그리면 약 210px라 레티나에서도 흐리지 않다.
 */
export const SLOT_THUMBNAIL_RENDER = {
  SCALE: 0.25,
  FIRST_PAGE_INDEX: 0
} as const;
