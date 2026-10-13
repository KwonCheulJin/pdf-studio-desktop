import { useCallback, useState } from "react";
import {
  MERGE_VIEW,
  useMergedDocument,
  useMergeView
} from "@/renderer/entities/merge-plan";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/renderer/shared/ui";
import { APP_MODE, useAppMode, useAppModeStore, type AppMode } from "../model";

/** 툴바 탭에 있는 모드(홈은 첫 화면이라 탭에 없다) */
type TabMode = Exclude<AppMode, typeof APP_MODE.HOME>;

interface ModeTab {
  mode: TabMode;
  label: string;
}

const MODE_TABS: readonly ModeTab[] = [
  { mode: APP_MODE.MERGE, label: "병합" },
  { mode: APP_MODE.COMPARE, label: "비교" },
  { mode: APP_MODE.TRANSLATE, label: "번역" }
];

/** 저장하지 않은 병합 결과를 두고 넘어갈 때 확인을 받는 모드(병합 탭으로 돌아오는 길은 확인하지 않는다) */
type LeaveMode = Exclude<TabMode, typeof APP_MODE.MERGE>;

interface LeaveConfirmText {
  description: string;
  action: string;
}

const LEAVE_CONFIRM_TEXT: Record<LeaveMode, LeaveConfirmText> = {
  [APP_MODE.COMPARE]: {
    description:
      "비교로 넘어가도 병합 결과는 그대로 남아요. 저장하려면 병합 탭으로 돌아와 다운로드하세요.",
    action: "비교로 이동"
  },
  [APP_MODE.TRANSLATE]: {
    description:
      "번역으로 넘어가도 병합 결과는 그대로 남아요. 저장하려면 병합 탭으로 돌아와 다운로드하세요.",
    action: "번역으로 이동"
  }
};

const ACTIVE_TAB_CLASS = "bg-card text-foreground font-medium shadow-xs";
const INACTIVE_TAB_CLASS = "text-muted-foreground hover:text-foreground";

/**
 * 병합·비교·번역 툴바 맨 왼쪽의 `[병합 | 비교 | 번역]` 세그먼트 탭(계획서 P3-1, P6-7).
 * 병합 결과 미리보기에 저장하지 않은 임시 결과가 있으면 비교·번역으로 넘어가기 전에 확인한다.
 * 넘어가도 결과는 지우지 않으므로 병합 탭으로 돌아오면 그대로 보인다.
 */
export function ModeTabs() {
  const mode = useAppMode();
  const setMode = useAppModeStore((state) => state.setMode);
  const mergeView = useMergeView();
  const mergedDocument = useMergedDocument();
  const [pendingMode, setPendingMode] = useState<LeaveMode | null>(null);

  const hasUnsavedMergeResult =
    mergeView === MERGE_VIEW.PREVIEW && mergedDocument !== null;

  const handleSelect = useCallback(
    (nextMode: TabMode) => {
      if (nextMode === mode) return;
      if (nextMode !== APP_MODE.MERGE && hasUnsavedMergeResult) {
        setPendingMode(nextMode);
        return;
      }
      setMode(nextMode);
    },
    [mode, hasUnsavedMergeResult, setMode]
  );

  const handleConfirmLeave = useCallback(() => {
    if (pendingMode === null) return;
    setPendingMode(null);
    setMode(pendingMode);
  }, [pendingMode, setMode]);

  const confirmText = pendingMode ? LEAVE_CONFIRM_TEXT[pendingMode] : null;

  return (
    <>
      <div
        role="tablist"
        aria-label="작업 모드"
        className="bg-secondary flex shrink-0 gap-0.5 rounded-full p-0.75"
      >
        {MODE_TABS.map((tab) => {
          const isActive = tab.mode === mode;
          return (
            <button
              key={tab.mode}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleSelect(tab.mode)}
              className={`focus-visible:ring-ring rounded-full px-3.5 py-1 text-sm/5.25 transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                isActive ? ACTIVE_TAB_CLASS : INACTIVE_TAB_CLASS
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {confirmText && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setPendingMode(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader className="text-left">
              <DialogTitle>저장하지 않은 병합 결과가 있어요</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {confirmText.description}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setPendingMode(null)}>
                취소
              </Button>
              <Button onClick={handleConfirmLeave}>{confirmText.action}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
