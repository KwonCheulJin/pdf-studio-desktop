import { useCallback, useMemo } from "react";
import {
  useMergeStore,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import {
  useSelectionStore,
  useSelectedIds,
  useSelectionType
} from "./selection-store";
import { SELECTION_TYPE } from "../config/selection-type";

interface UseSelectionActionsResult {
  handleDeleteSelected: () => void;
  /** 선택에 삭제된 페이지가 섞여 있는지 (복원 버튼 표시용) */
  hasDeletedInSelection: boolean;
  handleRestoreSelected: () => void;
  handleDeletePage: (fileId: string, pageId: string) => void;
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

  // 선택에 섞인 삭제된 페이지
  const selectedDeletedPages = useMemo(
    () =>
      files.flatMap((file) =>
        file.pages
          .filter((page) => page.isDeleted && selectedIds.has(page.id))
          .map((page) => ({ fileId: file.id, pageId: page.id }))
      ),
    [files, selectedIds]
  );

  // 선택된 삭제 페이지를 모두 복원 (선택은 그대로 둔다)
  const handleRestoreSelected = useCallback(() => {
    for (const { fileId, pageId } of selectedDeletedPages) {
      restorePage(fileId, pageId);
    }
  }, [selectedDeletedPages, restorePage]);

  return {
    handleDeleteSelected,
    hasDeletedInSelection: selectedDeletedPages.length > 0,
    handleRestoreSelected,
    handleDeletePage
  };
}
