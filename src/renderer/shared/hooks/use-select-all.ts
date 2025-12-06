import { useCallback, useMemo } from "react";
import { useMergeFiles } from "@/renderer/shared/model/merge-store";
import {
  useSelectionStore,
  useSelectedIds
} from "@/renderer/shared/model/selection-store";
import { SELECTION_TYPE } from "@/renderer/shared/constants/page-state";

interface UseSelectAllResult {
  isAllSelected: boolean;
  handleSelectAll: () => void;
}

export function useSelectAll(): UseSelectAllResult {
  const files = useMergeFiles();
  const selectedIds = useSelectedIds();
  const { selectAll, clearSelection, setSelectionType } = useSelectionStore();

  // 모든 파일 ID + 모든 페이지 ID
  const allIds = useMemo(() => {
    const fileIds = files.map((f) => f.id);
    const pageIds = files.flatMap((f) =>
      f.pages.filter((p) => !p.isDeleted).map((p) => p.id)
    );
    return [...fileIds, ...pageIds];
  }, [files]);

  const isAllSelected = useMemo(() => {
    if (allIds.length === 0) return false;
    return allIds.every((id) => selectedIds.has(id));
  }, [allIds, selectedIds]);

  const handleSelectAll = useCallback(() => {
    if (isAllSelected) {
      clearSelection();
    } else {
      setSelectionType(SELECTION_TYPE.FILE);
      selectAll(allIds);
    }
  }, [isAllSelected, allIds, selectAll, clearSelection, setSelectionType]);

  return {
    isAllSelected,
    handleSelectAll
  };
}
