/** 페이지 영역 배치(시안 4, 계획서 §7.1). 모두 CSS px다. */
export const VIEWER_LAYOUT = {
  /** 행 위 캡션 줄(위아래 10px + 글줄 16px) */
  CAPTION_HEIGHT_PX: 36,
  /** 행 아래 여백(시안 4 페이지 영역 아래 24px) */
  ROW_GAP_PX: 24,
  /** 페이지 영역 좌우 여백(시안 4 16px) */
  AREA_PADDING_X_PX: 16,
  /** "맞춤"일 때 쪽 양옆에 남기는 여백. 1280 창에서 쪽이 시안처럼 약 330px이 된다. */
  FIT_PAGE_MARGIN_PX: 24,
  /** 거터(연결선 자리, 계획서 §7.1): 세로 쪽 120px, 한쪽이라도 가로 쪽이면 72px. 확대와 상관없다. */
  GUTTER_PORTRAIT_PX: 120,
  GUTTER_LANDSCAPE_PX: 72,
  /** 화면 위아래로 미리 그려 둘 높이 */
  OVERSCAN_PX: 400
} as const;

/** 연결선 굵기(px, 계획서 §7.1): 평상시 2px, 고르거나 가리키면 3px, 마우스를 받는 투명한 선 14px */
export const CONNECTOR_STROKE_PX = {
  NORMAL: 2,
  EMPHASIZED: 3,
  HIT: 14
} as const;

/**
 * 마지막 스크롤 이벤트 뒤 이만큼 지나면 페이지 영역의 `data-scrolling`을 지운다(계획서 §7.1). 연결선이
 * 사라지고 다시 나타나는 CSS 전환(`connector-layer.tsx`의 `duration-140`)과 같은 값이다.
 */
export const SCROLL_IDLE_MS = 140;

/** 스크롤하는 동안 스크롤 컨테이너에 다는 속성 */
export const SCROLLING_ATTRIBUTE = "data-scrolling";

/** pdf.js 뷰어와 같은 100%: 1pt = 96/72 CSS px */
export const CSS_PX_PER_PT = 96 / 72;

export const ZOOM = {
  /** 확대·축소 버튼이 거치는 배율(%) */
  PRESETS: [25, 50, 75, 100, 125, 150, 200, 300],
  MIN_PERCENT: 25,
  MAX_PERCENT: 300,
  PERCENT_BASE: 100,
  /** "맞춤" 배율을 이 단위로 내린다(창 크기 변화마다 다시 그리지 않게) */
  FIT_SCALE_STEP: 0.005
} as const;

/** pdf.js로 그리는 배율: 화면 배율 × 기기 픽셀 비율을 이 단위로 올린다(렌더 캐시 재사용). */
export const RENDER_SCALE = {
  STEP: 0.25,
  MIN: 0.25,
  MAX: 4
} as const;

/**
 * 빠르게 스크롤하는 동안은 쪽을 그리지 않고 자리만 둔다(react-virtuoso scroll seek).
 * 값은 virtuoso가 재는 스크롤 속도다.
 */
export const SCROLL_SEEK_VELOCITY = {
  ENTER: 600,
  EXIT: 40
} as const;

export const VIEWER_TEXT = {
  PAGE_AREA: "페이지 영역",
  MINIMAP: "문서 전체 미니맵",
  ZOOM_OUT: "축소",
  ZOOM_IN: "확대",
  ZOOM_FIT: "맞춤",
  ZOOM_LEVEL: "배율",
  CURRENT_PAGE: "현재 쪽",
  RENDER_FAILED: "쪽을 그리지 못했어요"
} as const;

/** 짝 없는 쪽 자리표시 문구("A에 없는 쪽이에요") */
export const missingPageText = (badge: string) => `${badge}에 없는 쪽이에요`;
