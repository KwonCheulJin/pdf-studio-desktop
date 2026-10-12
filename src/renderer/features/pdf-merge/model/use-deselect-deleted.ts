import { useEffect } from "react";
import {
  useMergeStore,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import { useSelectionStore } from "./selection-store";

interface CollectDeletedIdsParams {
  previousFiles: PdfDocument[];
  nextFiles: PdfDocument[];
}

/**
 * 이번 변경으로 지워진 ID: 빠진 파일(과 그 페이지), 새로 삭제 표시된 페이지.
 * 이미 삭제된 페이지는 넣지 않는다(복원하려고 다시 고른 선택을 지우지 않게).
 */
function collectDeletedIds({
  previousFiles,
  nextFiles
}: CollectDeletedIdsParams): string[] {
  const nextFileById = new Map(nextFiles.map((file) => [file.id, file]));
  return previousFiles.flatMap((file) => {
    const nextFile = nextFileById.get(file.id);
    if (!nextFile) {
      return [file.id, ...file.pages.map((page) => page.id)];
    }
    const nextDeletedPageIds = new Set(
      nextFile.pages.filter((page) => page.isDeleted).map((page) => page.id)
    );
    return file.pages
      .filter((page) => !page.isDeleted && nextDeletedPageIds.has(page.id))
      .map((page) => page.id);
  });
}

/**
 * 어떤 경로로든(카드 버튼, 플로팅 바, 단축키, 전체 삭제) 파일·페이지가 지워지면 선택에서도 뺀다.
 */
export function useDeselectDeleted(): void {
  useEffect(
    () =>
      useMergeStore.subscribe((state, previousState) => {
        if (state.files === previousState.files) return;
        const deletedIds = collectDeletedIds({
          previousFiles: previousState.files,
          nextFiles: state.files
        });
        if (deletedIds.length > 0) {
          useSelectionStore.getState().removeFromSelection(deletedIds);
        }
      }),
    []
  );
}
