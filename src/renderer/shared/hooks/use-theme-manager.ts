import { useState, useEffect, useCallback } from "react";
import { IPC_CHANNEL } from "@/main/types/ipc-schema";

interface UseThemeManagerResult {
  isDark: boolean;
  handleToggleTheme: () => void;
}

/**
 * 다크 테마 관리를 위한 훅
 * - Electron IPC 또는 CSS 미디어 쿼리로 테마 변경 감지
 * - 테마 토글 기능 제공
 */
export function useThemeManager(): UseThemeManagerResult {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    // Electron IPC 또는 CSS 미디어 쿼리로 테마 변경 감지
    if (window.api?.onThemeChanged) {
      const handler = (dark: boolean) => setIsDark(dark);
      window.api.onThemeChanged(handler);
      return () => window.api.removeAllListeners(IPC_CHANNEL.THEME_CHANGED);
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  const handleToggleTheme = useCallback(() => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    document.documentElement.classList.toggle("dark", newIsDark);
  }, [isDark]);

  return { isDark, handleToggleTheme };
}
