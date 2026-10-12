import type { ValueOf } from "@/renderer/shared/types/common";

/** 사용자가 고르는 테마. `system`은 OS 설정(`prefers-color-scheme`)을 따른다. */
export const THEME_MODE = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark"
} as const;

export type ThemeMode = ValueOf<typeof THEME_MODE>;

/** 다크 토큰을 켜는 `<html>` 클래스(`app/styles/tokens.css`의 `.dark`) */
export const DARK_THEME_CLASS = "dark";

/** OS가 다크 모드인지 묻는 미디어 쿼리 */
export const DARK_COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";
