import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadErrorReportingSetting } from "@/renderer/features/error-reporting";
import { loadThemeMode } from "@/renderer/features/theme-toggle";
import { loadTranslateSettings } from "@/renderer/features/translate-settings";
import { THEME_MODE } from "@/renderer/shared/config/theme";
import { AppShell, AppToaster } from "./layout";
import {
  AppErrorBoundary,
  applyThemeMode,
  provideErrorReporting,
  providePlatform,
  ThemeProvider
} from "./providers";
import "./styles/index.css";

/**
 * 저장된 설정을 읽은 뒤 첫 화면을 그린다. 테마는 읽기 전에 OS 설정으로 먼저 맞춰
 * 설정을 기다리는 동안에도 배경색이 튀지 않게 한다.
 */
async function bootstrap(): Promise<void> {
  applyThemeMode(THEME_MODE.SYSTEM);
  providePlatform();
  provideErrorReporting();

  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Root element not found");
  }

  const [themeMode] = await Promise.all([
    loadThemeMode(),
    loadErrorReportingSetting(),
    loadTranslateSettings()
  ]);
  applyThemeMode(themeMode);

  createRoot(container).render(
    <StrictMode>
      <ThemeProvider>
        <AppErrorBoundary>
          <AppShell />
          <AppToaster />
        </AppErrorBoundary>
      </ThemeProvider>
    </StrictMode>
  );
}

void bootstrap();
