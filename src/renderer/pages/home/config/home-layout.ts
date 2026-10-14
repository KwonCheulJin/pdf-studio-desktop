/**
 * 홈 반응형 배치. Tailwind가 클래스를 찾을 수 있게 클래스 전체를 적는다.
 * 기본(앱 기본·최소 창 1280/1120px)은 시안 1 그대로이고, `2xl`(1536px 이상)부터 한 단계 키운다.
 * - 카드 묶음 폭: 960px → 1200px(1920px 창의 62.5%, 2000px 창의 60%)
 * - 그림: 상자 높이 168px → 208px, 안의 그림은 1.25배(`zoom`)라 상자 비율이 그대로다
 * - 카드 제목 18/26 → 20/28, 설명 14/21 → 16/24
 */
/** 홈 스크롤 영역·콘텐츠 묶음의 테스트 id(E2E가 가운데 배치를 잰다) */
export const HOME_TEST_ID = {
  PAGE: "home-page",
  CONTENT: "home-content"
} as const;

/** 그림 상자의 테스트 id(E2E가 상자 안에 그림이 들어가는지 잰다) */
export const HOME_ILLUSTRATION_TEST_ID = "home-illustration";

export const HOME_LAYOUT = {
  /** 카드 묶음 폭 상한 */
  CONTENT_WIDTH: "max-w-240 2xl:max-w-300",
  /** 그림 상자(`canvas` 바탕) */
  ILLUSTRATION_FRAME:
    "bg-canvas flex h-42 items-center justify-center rounded-md 2xl:h-52",
  /** 그림 상자 안의 그림 묶음. 상자와 같은 비율로 커진다. */
  ILLUSTRATION_SCALE: "flex items-center 2xl:[zoom:1.25]",
  CARD_TITLE: "text-lg/6.5 font-semibold 2xl:text-xl/7",
  CARD_DESCRIPTION: "text-muted-foreground 2xl:text-base/6"
} as const;
