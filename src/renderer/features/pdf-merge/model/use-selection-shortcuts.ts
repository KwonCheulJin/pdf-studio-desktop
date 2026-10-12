import { useEffect } from "react";
import {
  isEditableTarget,
  isPrimaryModifierPressed
} from "@/renderer/shared/lib/keyboard";

/** macOS의 delete 키는 Backspace로 들어온다. */
const DELETE_KEYS = new Set(["Delete", "Backspace"]);
const ESCAPE_KEY = "Escape";
/** 한글 입력 상태에서도 같은 자판 자리로 잡도록 key 대신 code를 본다. */
const SELECT_ALL_CODE = "KeyA";

interface UseSelectionShortcutsParams {
  /** 모달·진행 오버레이가 열렸거나 카드를 집고 있으면 false */
  isEnabled: boolean;
  onDelete: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

/**
 * 선택 단축키: Delete 선택 삭제, ⌘(macOS)/Ctrl+A 전체 선택, Esc 선택 해제.
 * 글자 입력 요소에 포커스가 있으면 가로채지 않는다.
 * Space·Enter·방향키는 카드 재정렬(dnd-kit 키보드 센서)이 쓰므로 여기서 다루지 않는다.
 */
export function useSelectionShortcuts({
  isEnabled,
  onDelete,
  onSelectAll,
  onClearSelection
}: UseSelectionShortcutsParams): void {
  useEffect(() => {
    if (!isEnabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      const hasPrimaryModifier = isPrimaryModifierPressed(event);

      if (hasPrimaryModifier && event.code === SELECT_ALL_CODE) {
        event.preventDefault();
        onSelectAll();
        return;
      }
      if (hasPrimaryModifier || event.altKey || event.shiftKey) return;

      if (DELETE_KEYS.has(event.key)) {
        event.preventDefault();
        onDelete();
      } else if (event.key === ESCAPE_KEY) {
        onClearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, onDelete, onSelectAll, onClearSelection]);
}
