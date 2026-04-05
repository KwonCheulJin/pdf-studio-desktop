import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { ErrorSnapshotBoundary } from "@kwoncheulJin/error-snapshot";
import { AppShell } from "./layout/app-shell";
import { getErrorSnapshot } from "../shared/lib/error-snapshot";
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

// Error Snapshot 초기화 (전역 에러 핸들러 포함)
const errorSnapshot = getErrorSnapshot();

createRoot(container).render(
  <StrictMode>
    <ErrorSnapshotBoundary
      instance={errorSnapshot}
      fallback={(code, reset) => (
        <div className="bg-background text-foreground flex h-screen flex-col items-center justify-center gap-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-900 dark:bg-red-950">
            <p className="text-lg font-medium text-red-700 dark:text-red-400">
              앗, 문제가 생겼어요
            </p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              아래 에러 코드를 전달해주세요
            </p>
            <code className="mt-3 inline-block rounded bg-red-100 px-4 py-2 text-base font-bold text-red-600 dark:bg-red-900 dark:text-red-300">
              {code}
            </code>
            <div className="mt-6">
              <button
                onClick={reset}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
              >
                다시 시도
              </button>
            </div>
          </div>
        </div>
      )}
    >
      <AppShell />
      <Toaster theme="system" position="bottom-right" richColors />
    </ErrorSnapshotBoundary>
  </StrictMode>
);
