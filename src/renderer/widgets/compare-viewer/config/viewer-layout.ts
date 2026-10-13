/** 페이지 영역 배치(시안 4, 계획서 §7.1). 모두 CSS px다. */
export const VIEWER_LAYOUT = {
  /** 행 위 캡션 줄(위아래 10px + 글줄 16px) */
  CAPTION_HEIGHT_PX: 36,
  /** 행 아래 여백(시안 4 페이지 영역 아래 24px) */
  ROW_GAP_PX: 24,
  /** 페이지 영역 바깥 좌우 여백(시안 4 16px). 나란히 보기는 A 패널 왼쪽·B 패널 오른쪽에 둔다. */
  AREA_PADDING_X_PX: 16,
  /** "맞춤"일 때 쪽 양옆에 남기는 여백. 1280 창에서 쪽이 시안처럼 약 330px이 된다. */
  FIT_PAGE_MARGIN_PX: 24,
  /** 두 패널 사이 거터(연결선이 건너는 자리, 계획서 §7.1). 확대와 상관없다. */
  GUTTER_PX: 120,
  /** 화면 위아래로 미리 그려 둘 높이 */
  OVERSCAN_PX: 400
} as const;

/**
 * 연결선(계획서 §7.1, 토큰 문서 §6.6). 색은 종류 토큰(`diff-*`)이고 굵기·불투명도·간격은 화면 px다.
 */
export const CONNECTOR_STYLE = {
  /** 선 굵기: 평상시, 고르거나 가리킬 때 */
  STROKE_PX: 1.5,
  EMPHASIZED_STROKE_PX: 3,
  /** 띠 테두리 굵기: 평상시, 고르거나 가리킬 때 */
  BAND_STROKE_PX: 1,
  EMPHASIZED_BAND_STROKE_PX: 2,
  /** 마우스를 받는 투명한 선(거터 구간만) */
  HIT_STROKE_PX: 14,
  /** 한쪽 끝이 화면 밖일 때: 흐린 점선 */
  CLAMPED_OPACITY: 0.45,
  CLAMPED_DASH: "2 4",
  /** 화면 밖 끝을 패널 위·아래 경계에서 들여놓는 거리와 방향 표시(V자)의 반 폭·높이 */
  CLAMP_INSET_PX: 8,
  CHEVRON_PX: 4
} as const;

/**
 * 연결선 끝의 줄 표시(계획서 §7.1 Step 28-d, 토큰 문서 §6.6): 쪽 너비 전체를 덮는 줄 높이 사각형. 종류 선
 * 색 얇은 테두리와 종류 `-fill`을 이 불투명도로 옅게 채운다(그 위의 변경 상자가 더 진하게 보인다).
 * 비교 PDF의 줄 표시도 같은 비율이다(Rust `ROW_FILL_ALPHA_DIVISOR`).
 */
export const ROW_BAND_STYLE = {
  STROKE_PX: 1,
  /** 고르거나 연결선을 가리킬 때 */
  EMPHASIZED_STROKE_PX: 2,
  FILL_OPACITY: 0.5
} as const;

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
  RENDER_FAILED: "쪽을 그리지 못했어요",
  SCROLL_SYNC: "동기 스크롤"
} as const;

/** 패널 이름("A 문서") */
export const paneLabel = (badge: string) => `${badge} 문서`;

/** 짝 없는 쪽 자리표시 문구("A에 없는 쪽이에요") */
export const missingPageText = (badge: string) => `${badge}에 없는 쪽이에요`;
