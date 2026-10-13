import type { ValueOf } from "@/renderer/shared/types/common";
import {
  TRANSLATE_VIEW,
  useTranslateSessionStore
} from "./translate-session-store";

/** 번역 화면이 지금 보이는 것 */
export const TRANSLATE_SCREEN = {
  OPTIONS: "options",
  PROGRESS: "progress",
  FAILURE: "failure",
  RESULT: "result"
} as const;

export type TranslateScreen = ValueOf<typeof TRANSLATE_SCREEN>;

/** 실행 중이면 진행 카드, 실패했으면 그 자리에 실패, 끝난 결과를 보는 중이면 결과, 아니면 옵션 화면 */
export function useTranslateScreen(): TranslateScreen {
  const isRunning = useTranslateSessionStore((state) => state.run !== null);
  const hasFailure = useTranslateSessionStore(
    (state) => state.failure !== null
  );
  const isShowingResult = useTranslateSessionStore(
    (state) => state.view === TRANSLATE_VIEW.RESULT && state.result !== null
  );
  if (isRunning) return TRANSLATE_SCREEN.PROGRESS;
  if (hasFailure) return TRANSLATE_SCREEN.FAILURE;
  return isShowingResult ? TRANSLATE_SCREEN.RESULT : TRANSLATE_SCREEN.OPTIONS;
}
