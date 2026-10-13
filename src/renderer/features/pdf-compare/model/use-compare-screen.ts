import type { ValueOf } from "@/renderer/shared/types/common";
import { useCompareRunStore } from "./compare-run-store";
import { COMPARE_VIEW, useCompareSessionStore } from "./compare-session-store";

/** 비교 화면이 지금 보이는 것 */
export const COMPARE_SCREEN = {
  OPTIONS: "options",
  PROGRESS: "progress",
  RESULT: "result"
} as const;

export type CompareScreen = ValueOf<typeof COMPARE_SCREEN>;

/** 실행 중이면 진행 카드, 끝난 결과를 보는 중이면 결과, 아니면 옵션 화면 */
export function useCompareScreen(): CompareScreen {
  const isRunning = useCompareRunStore((state) => state.jobId !== null);
  const isShowingResult = useCompareSessionStore(
    (state) => state.view === COMPARE_VIEW.RESULT && state.completed !== null
  );
  if (isRunning) return COMPARE_SCREEN.PROGRESS;
  return isShowingResult ? COMPARE_SCREEN.RESULT : COMPARE_SCREEN.OPTIONS;
}
