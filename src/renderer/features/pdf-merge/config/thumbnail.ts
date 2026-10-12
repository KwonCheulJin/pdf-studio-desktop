import { PAGE_ROTATION } from "@/renderer/entities/merge-plan";

/**
 * 카드 썸네일 렌더 설정
 */
export const THUMBNAIL_RENDER = {
  SCALE: 0.5,
  /** PDF `/Rotate`를 무시하고 그린다. 화면 회전은 스토어의 절대 회전을 CSS로 적용한다. */
  ROTATION: PAGE_ROTATION.DEG_0,
  /** 스크롤로 들어오기 직전에 미리 그리는 여백 */
  VIEWPORT_MARGIN: "200px"
} as const;
