import { useCallback } from "react";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import {
  useSelectedIds,
  useSelectionType
} from "@/renderer/shared/model/selection-store";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { ROTATION_DEGREES } from "@/main/types/ipc-schema";
import type { RotationDegrees } from "@/main/types/ipc-schema";
import { SELECTION_TYPE } from "@/renderer/shared/constants/page-state";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

interface UsePageRotationResult {
  handleRotatePage: (fileId: string, pageId: string) => Promise<void>;
  handleRotateSelected: () => Promise<void>;
  handleRotateSelectedCw: () => Promise<void>;
  handleRotateSelectedCcw: () => Promise<void>;
}

/**
 * 페이지 회전 로직을 관리하는 훅
 * - 개별 페이지 회전
 * - 선택된 항목 일괄 회전 (파일 또는 페이지)
 */
export function usePageRotation(files: PdfDocument[]): UsePageRotationResult {
  const rotatePage = useMergeStore((state) => state.rotatePage);
  const selectedIds = useSelectedIds();
  const selectionType = useSelectionType();

  // 개별 페이지 회전 핸들러 (90도 시계방향)
  const handleRotatePage = useCallback(
    async (fileId: string, pageId: string) => {
      const file = files.find((candidateFile) => candidateFile.id === fileId);
      if (!file) return;

      const page = file.pages.find(
        (candidatePage) => candidatePage.id === pageId
      );
      if (!page) return;

      const rotationDegrees = ROTATION_DEGREES.CW_90;

      // IPC로 파일 즉시 수정
      await ipcClient.edit.rotatePage({
        filePath: file.path,
        pageIndex: page.sourcePageIndex,
        rotationDegrees
      });

      // UI 상태 업데이트
      rotatePage(fileId, pageId, rotationDegrees);
    },
    [files, rotatePage]
  );

  // 선택된 항목 회전 (지정된 방향)
  const rotateSelectedWithDegrees = useCallback(
    async (rotationDegrees: RotationDegrees) => {
      if (selectionType === SELECTION_TYPE.FILE) {
        const selectedFiles = files.filter((file) => selectedIds.has(file.id));
        if (selectedFiles.length === 0) return;

        await Promise.all(
          selectedFiles.map(async (file) => {
            for (const page of file.pages) {
              await ipcClient.edit.rotatePage({
                filePath: file.path,
                pageIndex: page.sourcePageIndex,
                rotationDegrees
              });
              rotatePage(file.id, page.id, rotationDegrees);
            }
          })
        );
      } else {
        const pagesToRotate = files.flatMap((file) =>
          file.pages
            .filter((page) => selectedIds.has(page.id))
            .map((page) => ({ file, page }))
        );

        await Promise.all(
          pagesToRotate.map(async ({ file, page }) => {
            await ipcClient.edit.rotatePage({
              filePath: file.path,
              pageIndex: page.sourcePageIndex,
              rotationDegrees
            });
            rotatePage(file.id, page.id, rotationDegrees);
          })
        );
      }
    },
    [selectionType, files, selectedIds, rotatePage]
  );

  // 선택된 항목 시계방향 회전 (90도)
  const handleRotateSelectedCw = useCallback(async () => {
    await rotateSelectedWithDegrees(ROTATION_DEGREES.CW_90);
  }, [rotateSelectedWithDegrees]);

  // 선택된 항목 반시계방향 회전 (270도 = -90도)
  const handleRotateSelectedCcw = useCallback(async () => {
    await rotateSelectedWithDegrees(ROTATION_DEGREES.CW_270);
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
