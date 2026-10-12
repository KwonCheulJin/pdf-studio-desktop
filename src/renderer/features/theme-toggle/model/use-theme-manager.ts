import { useState, useEffect, useCallback } from "react";

interface UseThemeManagerResult {
  isDark: boolean;
  handleToggleTheme: () => void;
}

/**
 * 다크 테마 관리를 위한 훅
 * - CSS 미디어 쿼리로 테마 변경 감지
 * - 테마 토글 기능 제공
 */
export function useThemeManager(): UseThemeManagerResult {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
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
