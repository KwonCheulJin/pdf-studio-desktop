import { THEME_MODE, type ThemeMode } from "@/renderer/shared/config/theme";

/** 플랫폼 설정 저장소에서 테마를 두는 키 */
export const THEME_SETTING_KEY = "theme";

/** 설정 › 일반의 테마 묶음 제목 */
export const THEME_SETTING_TITLE = "테마";

/** 테마 버튼을 누를 때 넘어가는 순서(설정의 세그먼트 순서도 같다) */
export const THEME_MODE_ORDER: readonly ThemeMode[] = [
  THEME_MODE.SYSTEM,
  THEME_MODE.LIGHT,
  THEME_MODE.DARK
];

export const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  [THEME_MODE.SYSTEM]: "시스템",
  [THEME_MODE.LIGHT]: "라이트",
  [THEME_MODE.DARK]: "다크"
};
