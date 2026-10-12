import { create } from "zustand";
import { THEME_MODE, type ThemeMode } from "@/renderer/shared/config/theme";
import { getPlatform, LOG_LEVEL } from "@/renderer/shared/platform";
import { THEME_SETTING_KEY } from "../config/theme-setting";

interface ThemeStoreState {
  mode: ThemeMode;
}

interface ThemeStoreActions {
  /** 테마를 바꾸고 플랫폼 설정 저장소에 남긴다(재시작 후에도 유지). */
  setMode: (mode: ThemeMode) => void;
}

type ThemeStore = ThemeStoreState & ThemeStoreActions;

const THEME_MODES: readonly unknown[] = Object.values(THEME_MODE);

function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.includes(value);
}

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: THEME_MODE.SYSTEM,

  setMode: (mode) => {
    set({ mode });
    getPlatform()
      .setSetting({ key: THEME_SETTING_KEY, value: mode })
      .catch((error: unknown) => {
        getPlatform().log({
          level: LOG_LEVEL.WARN,
          message: `테마 설정 저장 실패: ${String(error)}`
        });
      });
  }
}));

export const useThemeMode = (): ThemeMode =>
  useThemeStore((state) => state.mode);

/**
 * 부팅 때 저장된 테마를 읽어 스토어에 넣는다. 없거나 모르는 값이면 `system`.
 * 읽기에 실패해도 앱은 `system`으로 뜬다.
 */
export async function loadThemeMode(): Promise<ThemeMode> {
  let stored: unknown;
  try {
    stored = await getPlatform().getSetting(THEME_SETTING_KEY);
  } catch (error) {
    getPlatform().log({
      level: LOG_LEVEL.WARN,
      message: `테마 설정 읽기 실패: ${String(error)}`
    });
  }
  const mode = isThemeMode(stored) ? stored : THEME_MODE.SYSTEM;
  useThemeStore.setState({ mode });
  return mode;
}
