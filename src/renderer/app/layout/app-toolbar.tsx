import { useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  useAddFiles,
  useSelectAll,
  useMergeExecution,
  useSelectionStore
} from "@/renderer/features/pdf-merge";
import {
  MERGE_STATUS,
  useMergeFiles,
  useMergeStatus,
  useMergeStore
} from "@/renderer/entities/merge-plan";
import { Button, Checkbox, Tooltip } from "@/renderer/shared/ui";
import { ModeTabs } from "./mode-tabs";

export function AppToolbar() {
  const files = useMergeFiles();
  const hasFiles = files.length > 0;
  const status = useMergeStatus();
  const clearFiles = useMergeStore((state) => state.clearFiles);
  const clearSelection = useSelectionStore((state) => state.clearSelection);

  const { handleAddFiles } = useAddFiles();
  const { isAllSelected, handleSelectAll } = useSelectAll();
  const { startMerge } = useMergeExecution();
  const isMerging = status === MERGE_STATUS.MERGING;
  const canClear = hasFiles && !isMerging;

  const handleClearAll = useCallback(() => {
    clearFiles();
    clearSelection();
  }, [clearFiles, clearSelection]);

  // 파일이 없으면 모드 탭만 둔다(빈 작업 공간에서도 비교로 갈 수 있게).
  if (!hasFiles) {
    return (
      <header className="border-border bg-card flex min-h-16 shrink-0 items-center border-b px-6 py-2">
        <ModeTabs />
      </header>
    );
  }

  return (
    <header className="border-border bg-card flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-2">
      {/* 좌측: 모드 탭, 전체 선택, 전체 삭제 */}
      <div className="flex min-w-65 flex-1 items-center gap-2">
        <div className="mr-2">
          <ModeTabs />
        </div>
        <label className="hover:bg-accent inline-flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-[13px]">
          <Checkbox
            checked={isAllSelected}
            onCheckedChange={handleSelectAll}
            aria-label="전체 선택"
          />
          <span>전체 선택</span>
        </label>
        <Tooltip content="전체 삭제">
          <Button
            variant="ghost"
            size="sm"
            disabled={!canClear}
            onClick={handleClearAll}
            className="gap-1.5 rounded-sm px-2.5 text-[13px] font-normal"
          >
            <Trash2 size={16} />
            <span>전체 삭제</span>
          </Button>
        </Tooltip>
      </div>

      {/* 중앙: 파일 추가 */}
      <Tooltip content="PDF 또는 이미지 파일 추가">
        <Button
          onClick={handleAddFiles}
          className="h-9 gap-1.5 rounded-md px-4 font-medium"
        >
          <Plus size={18} />
          <span>파일 추가</span>
        </Button>
      </Tooltip>

      {/* 우측: 병합 */}
      <div className="flex min-w-40 flex-1 items-center justify-end">
        <Tooltip content="모든 파일을 하나의 PDF로 병합">
          <Button
            disabled={!hasFiles || isMerging}
            onClick={startMerge}
            className="h-9 rounded-md px-5 font-medium"
          >
            {isMerging ? "병합 중..." : "병합"}
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
