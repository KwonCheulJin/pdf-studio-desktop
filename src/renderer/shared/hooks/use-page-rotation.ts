import { useCallback } from "react";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import {
  useSelectedIds,
  useSelectionType
} from "@/renderer/shared/model/selection-store";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { ROTATION_DEGREES } from "@/main/types/ipc-schema";
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

      try {
        // IPC로 파일 즉시 수정
        await ipcClient.edit.rotatePage({
          filePath: file.path,
          pageIndex: page.sourcePageIndex,
          rotationDegrees
        });

        // UI 상태 업데이트
        rotatePage(fileId, pageId, rotationDegrees);
      } catch (error) {
        console.error(
          `페이지 회전 실패: ${file.name} 페이지 ${page.sourcePageIndex + 1}`,
          error
        );
      }
    },
    [files, rotatePage]
  );

  // 선택된 항목 회전 (지정된 방향)
  const rotateSelectedWithDegrees = useCallback(
    async (rotationDegrees: number) => {
      if (selectionType === SELECTION_TYPE.FILE) {
        // 선택된 파일의 모든 페이지 회전
        const selectedFiles = files.filter((file) => selectedIds.has(file.id));
        if (selectedFiles.length === 0) return;

        for (const file of selectedFiles) {
          const pageIndices = Array.from(
            { length: file.pageCount },
            (_, i) => i
          );

          try {
            await ipcClient.edit.apply({
              filePath: file.path,
              operations: [
                {
                  type: "rotate",
                  pageIndices,
                  rotationDegrees
                }
              ]
            });

            // UI 상태 업데이트 - 모든 페이지 회전
            for (const page of file.pages) {
              rotatePage(file.id, page.id, rotationDegrees);
            }
          } catch (error) {
            console.error(`파일 회전 실패: ${file.name}`, error);
          }
        }
      } else {
        // 선택된 개별 페이지 회전
        for (const file of files) {
          for (const page of file.pages) {
            if (selectedIds.has(page.id)) {
              try {
                await ipcClient.edit.rotatePage({
                  filePath: file.path,
                  pageIndex: page.sourcePageIndex,
                  rotationDegrees
                });
                rotatePage(file.id, page.id, rotationDegrees);
              } catch (error) {
                console.error(
                  `페이지 회전 실패: ${file.name} 페이지 ${page.sourcePageIndex + 1}`,
                  error
                );
              }
            }
          }
        }
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
