import { useMemo } from "react";
import {
  countChanges,
  EMPTY_CHANGE_FILTER
} from "@/renderer/entities/comparison";
import {
  COMPARE_RESULT_TEXT,
  COMPARE_SCREEN,
  COMPARE_SLOT,
  COMPARE_SLOT_LABEL,
  compareResultMessage,
  useCompareRunStatus,
  useCompareScreen,
  useCompareSlotFile,
  useCompletedComparison,
  type CompareFile
} from "@/renderer/features/pdf-compare";
import { ThirdPartyNoticesButton } from "@/renderer/features/third-party-notices";
import { APP_STATUS } from "@/renderer/shared/constants";
import { compareRunningText } from "./compare-run-indicator";

const EMPTY_SLOT_TEXT = "비어 있음";

function pageCountText(file: CompareFile | null): string {
  return file ? `${file.pageCount}쪽` : EMPTY_SLOT_TEXT;
}

function Separator() {
  return <span className="text-muted-foreground/50 mx-2">|</span>;
}

/** 결과 화면 왼쪽: 필터와 상관없는 전체 차이·확인 필요 수(시안 4 "차이 25건") */
function ResultCounts() {
  const completed = useCompletedComparison();
  const counts = useMemo(
    () =>
      countChanges({
        changes: completed?.result.changes ?? [],
        filter: EMPTY_CHANGE_FILTER
      }),
    [completed]
  );
  return (
    <span>
      {compareResultMessage.differences(counts.totalDifferences)}
      {counts.totalReview > 0 && (
        <>
          <Separator />
          {compareResultMessage.review(counts.totalReview)}
        </>
      )}
    </span>
  );
}

/**
 * 비교 화면 상태바(시안 3·4·9): 왼쪽에 A·B 쪽수(결과 화면은 차이 수), 오른쪽에 상태
 * ("준비"·"비교 중 49%"·"완료")·버전
 */
export function AppCompareStatusBar() {
  const before = useCompareSlotFile(COMPARE_SLOT.BEFORE);
  const after = useCompareSlotFile(COMPARE_SLOT.AFTER);
  const screen = useCompareScreen();
  const { isRunning, overallPercent } = useCompareRunStatus();
  const isResult = screen === COMPARE_SCREEN.RESULT;
  const idleText = isResult
    ? COMPARE_RESULT_TEXT.STATUS_DONE
    : APP_STATUS.READY;
  const statusText = isRunning ? compareRunningText(overallPercent) : idleText;

  return (
    <footer className="border-border bg-background text-muted-foreground flex h-10 shrink-0 items-center justify-between gap-4 border-t px-6 text-sm">
      {isResult ? (
        <ResultCounts />
      ) : (
        <span>
          {COMPARE_SLOT_LABEL[COMPARE_SLOT.BEFORE].badge}{" "}
          {pageCountText(before)}
          <Separator />
          {COMPARE_SLOT_LABEL[COMPARE_SLOT.AFTER].badge} {pageCountText(after)}
        </span>
      )}
      <div className="flex items-center gap-3">
        <span role="status">상태: {statusText}</span>
        <span className="text-muted-foreground/50">|</span>
        <span>v{__APP_VERSION__}</span>
        <ThirdPartyNoticesButton />
      </div>
    </footer>
  );
}
