import type { ThemeMode } from "@/renderer/shared/config/theme";
import {
  SegmentedControl,
  SettingSection,
  type SegmentedOption
} from "@/renderer/shared/ui";
import {
  THEME_MODE_LABEL,
  THEME_MODE_ORDER,
  THEME_SETTING_TITLE
} from "../config/theme-setting";
import { useThemeMode, useThemeStore } from "../model/theme-store";

const THEME_OPTIONS: readonly SegmentedOption<ThemeMode>[] =
  THEME_MODE_ORDER.map((mode) => ({
    value: mode,
    label: THEME_MODE_LABEL[mode]
  }));

/** 설정 › 일반의 테마 `시스템 | 라이트 | 다크`. 도구 막대의 테마 버튼과 같은 설정이다. */
export function ThemeModeSetting() {
  const mode = useThemeMode();
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <SettingSection title={THEME_SETTING_TITLE}>
      <SegmentedControl
        label={THEME_SETTING_TITLE}
        options={THEME_OPTIONS}
        value={mode}
        onChange={setMode}
      />
    </SettingSection>
  );
}
