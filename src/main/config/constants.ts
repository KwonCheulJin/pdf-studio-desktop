/**
 * Main 프로세스 애플리케이션 설정 상수
 */
export const APP_CONFIG = {
  /** 출력 디렉토리명 (사용자 Documents 폴더 내) */
  OUTPUT_DIRECTORY_NAME: "PDF Studio"
} as const;

/**
 * BrowserWindow 기본 설정
 */
export const WINDOW_CONFIG = {
  /** 기본 윈도우 너비 (px) */
  WIDTH: 1200,
  /** 기본 윈도우 높이 (px) */
  HEIGHT: 800
} as const;
