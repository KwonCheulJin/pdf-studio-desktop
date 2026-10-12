import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { THEME_MODE, type ThemeMode } from "@/renderer/shared/config/theme";
import { Button, Tooltip } from "@/renderer/shared/ui";
import { THEME_MODE_LABEL, THEME_MODE_ORDER } from "../config/theme-setting";
import { useThemeMode, useThemeStore } from "../model/theme-store";

const THEME_MODE_ICON: Record<ThemeMode, LucideIcon> = {
  [THEME_MODE.SYSTEM]: Monitor,
  [THEME_MODE.LIGHT]: Sun,
  [THEME_MODE.DARK]: Moon
};

function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_MODE_ORDER.indexOf(mode);
  return THEME_MODE_ORDER[(index + 1) % THEME_MODE_ORDER.length];
}

/** 누를 때마다 시스템 → 라이트 → 다크 순서로 테마를 바꾼다. */
export function ThemeToggleButton() {
  const mode = useThemeMode();
  const setMode = useThemeStore((state) => state.setMode);
  const next = nextThemeMode(mode);
  const Icon = THEME_MODE_ICON[mode];

  return (
    <Tooltip
      content={`테마: ${THEME_MODE_LABEL[mode]} (누르면 ${THEME_MODE_LABEL[next]})`}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setMode(next)}
        aria-label={`테마: ${THEME_MODE_LABEL[mode]}`}
      >
        <Icon size={16} />
      </Button>
    </Tooltip>
  );
}
