import { useCallback } from "react";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import {
  useSelectedIds,
  useSelectionType
} from "@/renderer/shared/model/selection-store";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { ROTATION_DEGREES, PAGE_OPERATION_TYPE } from "@/main/types/ipc-schema";
import type { RotationDegrees } from "@/main/types/ipc-schema";
import { SELECTION_TYPE } from "@/renderer/shared/constants/page-state";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

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

      const rotationDegrees = ROTATION_DEGREES.CW_90;

      // UI 상태 즉시 업데이트
      rotatePage(fileId, pageId, rotationDegrees);

      // IPC로 파일 저장 (비동기, 실패 시 로그)
      ipcClient.edit
        .rotatePage({
          filePath: file.path,
          pageIndex: page.sourcePageIndex,
          rotationDegrees
        })
        .catch((error: unknown) => {
          ipcClient.log.error(`페이지 회전 파일 저장 실패: ${String(error)}`);
        });
    },
    [files, rotatePage]
  );

  // 선택된 항목 회전 (지정된 방향)
  const rotateSelectedWithDegrees = useCallback(
    (rotationDegrees: RotationDegrees) => {
      if (selectionType === SELECTION_TYPE.FILE) {
        const selectedFiles = files.filter((file) => selectedIds.has(file.id));
        if (selectedFiles.length === 0) return;

        // UI 상태 즉시 업데이트
        for (const file of selectedFiles) {
          for (const page of file.pages) {
            rotatePage(file.id, page.id, rotationDegrees);
          }
        }

        // 파일별 단일 쓰기 (동시 쓰기 방지)
        Promise.all(
          selectedFiles.map((file) => {
            const pageIndices = file.pages.map((page) => page.sourcePageIndex);
            return ipcClient.edit
              .apply({
                filePath: file.path,
                operations: [
                  {
                    type: PAGE_OPERATION_TYPE.ROTATE,
                    pageIndices,
                    rotationDegrees
                  }
                ]
              })
              .catch((error: unknown) => {
                ipcClient.log.error(
                  `일괄 회전 파일 저장 실패: ${file.path} - ${String(error)}`
                );
              });
          })
        );
      } else {
        const pagesToRotate = files.flatMap((file) =>
          file.pages
            .filter((page) => selectedIds.has(page.id))
            .map((page) => ({ file, page }))
        );
        if (pagesToRotate.length === 0) return;

        // UI 상태 즉시 업데이트
        for (const { file, page } of pagesToRotate) {
          rotatePage(file.id, page.id, rotationDegrees);
        }

        // 파일별 그룹화 후 단일 쓰기 (동시 쓰기 방지)
        const pagesByFile = new Map<
          string,
          { filePath: string; pageIndices: number[] }
        >();
        for (const { file, page } of pagesToRotate) {
          const existing = pagesByFile.get(file.id);
          if (existing) {
            existing.pageIndices.push(page.sourcePageIndex);
          } else {
            pagesByFile.set(file.id, {
              filePath: file.path,
              pageIndices: [page.sourcePageIndex]
            });
          }
        }

        Promise.all(
          Array.from(pagesByFile.values()).map(({ filePath, pageIndices }) =>
            ipcClient.edit
              .apply({
                filePath,
                operations: [
                  {
                    type: PAGE_OPERATION_TYPE.ROTATE,
                    pageIndices,
                    rotationDegrees
                  }
                ]
              })
              .catch((error: unknown) => {
                ipcClient.log.error(
                  `일괄 회전 파일 저장 실패: ${filePath} - ${String(error)}`
                );
              })
          )
        );
      }
    },
    [selectionType, files, selectedIds, rotatePage]
  );

  // 선택된 항목 시계방향 회전 (90도)
  const handleRotateSelectedCw = useCallback(() => {
    rotateSelectedWithDegrees(ROTATION_DEGREES.CW_90);
  }, [rotateSelectedWithDegrees]);

  // 선택된 항목 반시계방향 회전 (270도 = -90도)
  const handleRotateSelectedCcw = useCallback(() => {
    rotateSelectedWithDegrees(ROTATION_DEGREES.CW_270);
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
