import { useCallback, useMemo } from "react";
import { useMergeFiles } from "@/renderer/entities/merge-plan";
import { useSelectionStore, useSelectedIds } from "./selection-store";
import { SELECTION_TYPE } from "../config/selection-type";

interface UseSelectAllResult {
  isAllSelected: boolean;
  /** 전체 선택 체크박스: 모두 선택돼 있으면 해제, 아니면 전체 선택 */
  handleSelectAll: () => void;
  /** 전체 선택 단축키: 늘 전체 선택 */
  selectAllItems: () => void;
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

  const selectAllItems = useCallback(() => {
    setSelectionType(SELECTION_TYPE.FILE);
    selectAll(allIds);
  }, [allIds, selectAll, setSelectionType]);

  const handleSelectAll = useCallback(() => {
    if (isAllSelected) {
      clearSelection();
    } else {
      selectAllItems();
    }
  }, [isAllSelected, clearSelection, selectAllItems]);

  return {
    isAllSelected,
    handleSelectAll,
    selectAllItems
  };
}
