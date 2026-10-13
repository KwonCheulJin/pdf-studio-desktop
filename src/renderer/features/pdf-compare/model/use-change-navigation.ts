import { useCallback, useEffect, useMemo } from "react";
import {
  changePositionOf,
  type ChangePosition
} from "@/renderer/entities/comparison";
import { isEditableTarget } from "@/renderer/shared/lib/keyboard";
import {
  useActiveChangeId,
  useChangeFilter,
  useCompareSessionStore,
  useCompletedComparison
} from "./compare-session-store";

/** 이전/다음 키(계획서 P3-4 ↑↓·j/k). j/k는 한글 입력 상태에서도 같은 자판 자리로 잡도록 code를 본다. */
const PREVIOUS_KEYS = new Set(["ArrowUp"]);
const NEXT_KEYS = new Set(["ArrowDown"]);
const PREVIOUS_CODE = "KeyK";
const NEXT_CODE = "KeyJ";
/** 대화상자·메뉴 안의 방향키는 그쪽이 쓴다. */
const KEYBOARD_OWNER_SELECTOR = "[role='dialog'], [role='menu']";

export interface ChangeNavigation extends ChangePosition {
  goPrevious: () => void;
  goNext: () => void;
}

/** 결과 화면의 이전/다음 이동(툴바 버튼·키보드가 같이 쓴다) */
export function useChangeNavigation(): ChangeNavigation {
  const completed = useCompletedComparison();
  const filter = useChangeFilter();
  const activeChangeId = useActiveChangeId();
  const selectChange = useCompareSessionStore((state) => state.selectChange);

  const position = useMemo(
    () =>
      changePositionOf({
        changes: completed?.result.changes ?? [],
        filter,
        activeChangeId
      }),
    [completed, filter, activeChangeId]
  );
  const { previousId, nextId } = position;

  const goPrevious = useCallback(() => {
    if (previousId !== null) selectChange(previousId);
  }, [previousId, selectChange]);
  const goNext = useCallback(() => {
    if (nextId !== null) selectChange(nextId);
  }, [nextId, selectChange]);

  return { ...position, goPrevious, goNext };
}

function isOwnedByOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(KEYBOARD_OWNER_SELECTOR) !== null
  );
}

interface UseChangeKeyboardParams {
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * ↑·k 이전, ↓·j 다음. 글자 입력 요소·대화상자·메뉴에서 누른 키와 보조키 조합은 가로채지 않는다.
 * 방향키로 페이지 영역이 스크롤되지 않게 막는다(이동한 변경으로 화면이 따라간다).
 */
export function useChangeKeyboard({
  onPrevious,
  onNext
}: UseChangeKeyboardParams): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isEditableTarget(event.target) ||
        isOwnedByOverlay(event.target)
      ) {
        return;
      }
      if (PREVIOUS_KEYS.has(event.key) || event.code === PREVIOUS_CODE) {
        event.preventDefault();
        onPrevious();
      } else if (NEXT_KEYS.has(event.key) || event.code === NEXT_CODE) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onPrevious, onNext]);
}
