import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./layout/app-shell";
import "../styles/index.css";

// 테마 적용 함수
function applyTheme(isDark: boolean): void {
  document.documentElement.classList.toggle("dark", isDark);
}

// 초기 테마 설정 (CSS 미디어 쿼리 기반)
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
applyTheme(prefersDark);

// 시스템 테마 변경 감지
if (window.api?.onThemeChanged) {
  // Electron IPC 사용 (preload 스크립트가 로드된 경우)
  window.api.onThemeChanged(applyTheme);
} else {
  // Fallback: CSS 미디어 쿼리 사용
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      applyTheme(e.matches);
    });
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element not found");
}

createRoot(container).render(
  <StrictMode>
    <AppShell />
  </StrictMode>
);
