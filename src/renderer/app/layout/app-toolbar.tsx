import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Tooltip } from "@/renderer/shared/ui";
import {
  useMergeFiles,
  useMergeStatus,
  useMergeStore
} from "@/renderer/shared/model/merge-store";
import { MERGE_STATUS } from "@/renderer/shared/model/merge-state";
import { useAddFiles } from "@/renderer/shared/hooks/use-add-files";
import { useSelectAll } from "@/renderer/shared/hooks/use-select-all";
import { useMergeExecution } from "@/renderer/shared/hooks/use-merge-execution";
import { useSelectionStore } from "@/renderer/shared/model/selection-store";

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

  const handleClearAll = () => {
    clearFiles();
    clearSelection();
  };

  if (!hasFiles) {
    return null;
  }

  return (
    <header className="border-border bg-card flex h-16 shrink-0 items-center justify-between border-b px-6">
      {/* 좌측: Select All */}
      <div className="flex w-40 items-center gap-2">
        <Tooltip content="전체 선택">
          <div
            role="button"
            tabIndex={0}
            onClick={handleSelectAll}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleSelectAll();
              }
            }}
            className="hover:bg-accent inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm"
          >
            <Checkbox checked={isAllSelected} />
          </div>
        </Tooltip>
        <Tooltip content="전체 삭제">
          <Button
            variant="ghost"
            size="sm"
            disabled={!canClear}
            onClick={handleClearAll}
          >
            <Trash2 size={16} />
            <span>전체 삭제</span>
          </Button>
        </Tooltip>
      </div>

      {/* 중앙: 파일 추가 */}
      <Tooltip content="PDF 또는 이미지 파일 추가">
        <Button onClick={handleAddFiles}>
          <Plus size={18} />
          <span>파일 추가</span>
        </Button>
      </Tooltip>

      {/* 우측: 병합 */}
      <div className="flex w-40 items-center justify-end">
        <Tooltip content="선택한 파일을 하나의 PDF로 병합">
          <Button disabled={!hasFiles || isMerging} onClick={startMerge}>
            {isMerging ? "병합 중..." : "병합"}
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
