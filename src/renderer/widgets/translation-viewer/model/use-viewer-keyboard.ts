import { useEffect } from "react";
import { isEditableTarget } from "@/renderer/shared/lib/keyboard";

/** ←→ 쪽 이동, ↑↓ 문단 고르기(계획서 P6-11). 값은 옮길 방향 */
const PAGE_STEP_KEYS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1
};

const PARAGRAPH_STEP_KEYS: Readonly<Record<string, number>> = {
  ArrowUp: -1,
  ArrowDown: 1
};

/** 대화상자·메뉴(설정 모달·용어집 팝오버) 안의 방향키는 그쪽이 쓴다. */
const KEYBOARD_OWNER_SELECTOR =
  "[role='dialog'], [role='alertdialog'], [role='menu']";

function isOwnedByOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(KEYBOARD_OWNER_SELECTOR) !== null
  );
}

function isIgnored(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    isEditableTarget(event.target) ||
    isOwnedByOverlay(event.target)
  );
}

interface UseViewerKeyboardParams {
  onPageStep: (step: number) => void;
  onParagraphStep: (step: number) => void;
}

/**
 * 결과 화면 키보드: ←→ 쪽, ↑↓ 문단. 글자 입력 요소(쪽 번호 칸)·대화상자·메뉴에서 누른 키와 보조키 조합은
 * 가로채지 않는다. 방향키로 본문이 스크롤되지 않게 막는다(고른 문단으로 화면이 따라간다).
 */
export function useViewerKeyboard({
  onPageStep,
  onParagraphStep
}: UseViewerKeyboardParams): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isIgnored(event)) return;
      const pageStep = PAGE_STEP_KEYS[event.key];
      const paragraphStep = PARAGRAPH_STEP_KEYS[event.key];
      if (pageStep !== undefined) {
        event.preventDefault();
        onPageStep(pageStep);
      } else if (paragraphStep !== undefined) {
        event.preventDefault();
        onParagraphStep(paragraphStep);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onPageStep, onParagraphStep]);
}
