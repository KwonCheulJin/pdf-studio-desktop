import {
  COMPARE_SLOT,
  COMPARE_SLOT_LABEL,
  useCompareRunStatus,
  useCompareSlotFile,
  type CompareFile
} from "@/renderer/features/pdf-compare";
import { ThirdPartyNoticesButton } from "@/renderer/features/third-party-notices";
import { APP_STATUS } from "@/renderer/shared/constants";
import { compareRunningText } from "./compare-run-indicator";

const EMPTY_SLOT_TEXT = "비어 있음";

function pageCountText(file: CompareFile | null): string {
  return file ? `${file.pageCount}쪽` : EMPTY_SLOT_TEXT;
}

/** 비교 화면 상태바(시안 3·9): 왼쪽에 A·B 쪽수, 오른쪽에 상태("준비"·"비교 중 49%")·버전 */
export function AppCompareStatusBar() {
  const before = useCompareSlotFile(COMPARE_SLOT.BEFORE);
  const after = useCompareSlotFile(COMPARE_SLOT.AFTER);
  const { isRunning, overallPercent } = useCompareRunStatus();
  const statusText = isRunning
    ? compareRunningText(overallPercent)
    : APP_STATUS.READY;

  return (
    <footer className="border-border bg-background text-muted-foreground flex h-10 shrink-0 items-center justify-between gap-4 border-t px-6 text-sm">
      <span>
        {COMPARE_SLOT_LABEL[COMPARE_SLOT.BEFORE].badge} {pageCountText(before)}
        <span className="text-muted-foreground/50 mx-2">|</span>
        {COMPARE_SLOT_LABEL[COMPARE_SLOT.AFTER].badge} {pageCountText(after)}
      </span>
      <div className="flex items-center gap-3">
        <span role="status">상태: {statusText}</span>
        <span className="text-muted-foreground/50">|</span>
        <span>v{__APP_VERSION__}</span>
        <ThirdPartyNoticesButton />
      </div>
    </footer>
  );
}
