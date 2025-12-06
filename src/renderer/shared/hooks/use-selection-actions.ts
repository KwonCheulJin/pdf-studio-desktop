import { useCallback } from "react";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import {
  useSelectionStore,
  useSelectedIds,
  useSelectionType
} from "@/renderer/shared/model/selection-store";
import { SELECTION_TYPE } from "@/renderer/shared/constants/page-state";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

interface UseSelectionActionsResult {
  handleDeleteSelected: () => void;
  handleDeletePage: (fileId: string, pageId: string) => void;
  handleRestorePage: (fileId: string, pageId: string) => void;
}

/**
 * 선택 항목에 대한 액션(삭제, 복원)을 관리하는 훅
 */
export function useSelectionActions(
  files: PdfDocument[]
): UseSelectionActionsResult {
  const removeFile = useMergeStore((state) => state.removeFile);
  const deletePage = useMergeStore((state) => state.deletePage);
  const restorePage = useMergeStore((state) => state.restorePage);

  const selectedIds = useSelectedIds();
  const selectionType = useSelectionType();
  const { clearSelection, removeFromSelection } = useSelectionStore();

  // 페이지 삭제 핸들러 (soft delete)
  const handleDeletePage = useCallback(
    (fileId: string, pageId: string) => {
      deletePage(fileId, pageId);
      // 선택에서도 제거
      if (selectedIds.has(pageId)) {
        removeFromSelection(pageId);
      }
    },
    [deletePage, selectedIds, removeFromSelection]
  );

  // 페이지 복원 핸들러
  const handleRestorePage = useCallback(
    (fileId: string, pageId: string) => {
      restorePage(fileId, pageId);
    },
    [restorePage]
  );

  // 선택된 항목 삭제 (파일 또는 페이지)
  const handleDeleteSelected = useCallback(() => {
    if (selectionType === SELECTION_TYPE.FILE) {
      // 파일 삭제
      const idsToRemove = Array.from(selectedIds);
      idsToRemove.forEach((id) => removeFile(id));
    } else {
      // 페이지 삭제 (soft delete)
      for (const file of files) {
        for (const page of file.pages) {
          if (selectedIds.has(page.id)) {
            deletePage(file.id, page.id);
          }
        }
      }
    }
    clearSelection();
  }, [
    selectionType,
    selectedIds,
    removeFile,
    files,
    deletePage,
    clearSelection
  ]);

  return {
    handleDeleteSelected,
    handleDeletePage,
    handleRestorePage
  };
}
