import { useEffect } from "react";
import { isPrimaryModifierPressed } from "@/renderer/shared/lib/keyboard";

/** 설정을 여는 키(⌘, · Ctrl+,) */
const SETTINGS_SHORTCUT_KEY = ",";

/** 모든 화면에서 ⌘,(macOS)·Ctrl+,(그 밖)로 설정을 연다(Q16). 글자를 치는 키가 아니라 입력 칸에서도 받는다. */
export function useSettingsShortcut(onOpen: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.altKey || event.shiftKey) return;
      if (!isPrimaryModifierPressed(event)) return;
      if (event.key !== SETTINGS_SHORTCUT_KEY) return;
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpen]);
}
