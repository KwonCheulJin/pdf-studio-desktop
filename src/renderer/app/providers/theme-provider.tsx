import { useEffect, type ReactNode } from "react";
import { useThemeMode } from "@/renderer/features/theme-toggle";
import {
  DARK_COLOR_SCHEME_QUERY,
  DARK_THEME_CLASS,
  THEME_MODE,
  type ThemeMode
} from "@/renderer/shared/config/theme";

interface ThemeProviderProps {
  children: ReactNode;
}

function setDarkClass(isDark: boolean): void {
  document.documentElement.classList.toggle(DARK_THEME_CLASS, isDark);
}

/** 테마 설정대로 `<html>`의 `.dark`를 켜고 끈다. `system`이면 지금 OS 설정을 따른다. */
export function applyThemeMode(mode: ThemeMode): void {
  if (mode === THEME_MODE.SYSTEM) {
    setDarkClass(window.matchMedia(DARK_COLOR_SCHEME_QUERY).matches);
    return;
  }
  setDarkClass(mode === THEME_MODE.DARK);
}

/**
 * 테마 설정(`features/theme-toggle`)을 화면에 맞춘다.
 * `system`인 동안만 OS 다크 모드 변경을 구독하고, 설정이 바뀌거나 내려가면 구독을 푼다.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const mode = useThemeMode();

  useEffect(() => {
    applyThemeMode(mode);
    if (mode !== THEME_MODE.SYSTEM) return;
    const query = window.matchMedia(DARK_COLOR_SCHEME_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setDarkClass(event.matches);
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [mode]);

  return children;
}
