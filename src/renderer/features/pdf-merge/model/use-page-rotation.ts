import { useCallback } from "react";
import {
  PAGE_ROTATION,
  useMergeStore,
  type PageRotation,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import { useSelectedIds, useSelectionType } from "./selection-store";
import { SELECTION_TYPE } from "../config/selection-type";

interface UsePageRotationResult {
  handleRotatePage: (fileId: string, pageId: string) => void;
  handleRotateSelected: () => void;
  handleRotateSelectedCw: () => void;
  handleRotateSelectedCcw: () => void;
}

/**
 * 페이지 회전 로직을 관리하는 훅
 * - 개별 페이지 회전
 * - 선택된 항목 일괄 회전 (파일 또는 페이지)
 * 회전은 스토어에만 기록하고 병합 요청에 담는다(원본 파일은 바꾸지 않는다).
 */
export function usePageRotation(files: PdfDocument[]): UsePageRotationResult {
  const rotatePage = useMergeStore((state) => state.rotatePage);
  const selectedIds = useSelectedIds();
  const selectionType = useSelectionType();

  // 개별 페이지 회전 핸들러 (90도 시계방향)
  const handleRotatePage = useCallback(
    (fileId: string, pageId: string) => {
      const file = files.find((candidateFile) => candidateFile.id === fileId);
      if (!file) return;

      const page = file.pages.find(
        (candidatePage) => candidatePage.id === pageId
      );
      if (!page) return;

      rotatePage(fileId, pageId, PAGE_ROTATION.DEG_90);
    },
    [files, rotatePage]
  );

  // 선택된 항목 회전 (지정된 방향)
  const rotateSelectedWithDegrees = useCallback(
    (rotationDegrees: PageRotation) => {
      if (selectionType === SELECTION_TYPE.FILE) {
        const selectedFiles = files.filter((file) => selectedIds.has(file.id));
        if (selectedFiles.length === 0) return;

        for (const file of selectedFiles) {
          for (const page of file.pages) {
            rotatePage(file.id, page.id, rotationDegrees);
          }
        }
      } else {
        const pagesToRotate = files.flatMap((file) =>
          file.pages
            .filter((page) => selectedIds.has(page.id))
            .map((page) => ({ file, page }))
        );
        if (pagesToRotate.length === 0) return;

        for (const { file, page } of pagesToRotate) {
          rotatePage(file.id, page.id, rotationDegrees);
        }
      }
    },
    [selectionType, files, selectedIds, rotatePage]
  );

  // 선택된 항목 시계방향 회전 (90도)
  const handleRotateSelectedCw = useCallback(() => {
    rotateSelectedWithDegrees(PAGE_ROTATION.DEG_90);
  }, [rotateSelectedWithDegrees]);

  // 선택된 항목 반시계방향 회전 (270도 = -90도)
  const handleRotateSelectedCcw = useCallback(() => {
    rotateSelectedWithDegrees(PAGE_ROTATION.DEG_270);
  }, [rotateSelectedWithDegrees]);

  // 기존 handleRotateSelected는 시계방향으로 유지 (하위 호환)
  const handleRotateSelected = handleRotateSelectedCw;

  return {
    handleRotatePage,
    handleRotateSelected,
    handleRotateSelectedCw,
    handleRotateSelectedCcw
  };
}
