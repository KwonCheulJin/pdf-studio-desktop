import { useCallback } from "react";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import { ROTATION_DEGREES } from "@/main/types/ipc-schema";
import type { PdfPage } from "@/renderer/shared/model/pdf-document";

interface UsePageRotateHandlersParams {
  fileId: string;
  page: PdfPage;
  filePath: string;
}

interface UsePageRotateHandlersResult {
  handleRotateCw: (event: React.MouseEvent) => Promise<void>;
  handleRotateCcw: (event: React.MouseEvent) => Promise<void>;
}

/**
 * 개별 페이지 카드의 시계 방향/반시계 방향 회전 핸들러
 * PageThumbnail, ExpandedPageCard 등에서 공통으로 사용
 */
export function usePageRotateHandlers({
  fileId,
  page,
  filePath
}: UsePageRotateHandlersParams): UsePageRotateHandlersResult {
  const rotatePage = useMergeStore((state) => state.rotatePage);

  const handleRotateCw = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      try {
        await ipcClient.edit.rotatePage({
          filePath,
          pageIndex: page.sourcePageIndex,
          rotationDegrees: ROTATION_DEGREES.CW_90
        });
        rotatePage(fileId, page.id, ROTATION_DEGREES.CW_90);
      } catch (error) {
        ipcClient.log.error(
          `페이지 회전 실패: 페이지 ${page.sourcePageIndex + 1} - ${String(error)}`
        );
      }
    },
    [fileId, page.id, page.sourcePageIndex, filePath, rotatePage]
  );

  const handleRotateCcw = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      try {
        await ipcClient.edit.rotatePage({
          filePath,
          pageIndex: page.sourcePageIndex,
          rotationDegrees: ROTATION_DEGREES.CW_270
        });
        rotatePage(fileId, page.id, ROTATION_DEGREES.CW_270);
      } catch (error) {
        ipcClient.log.error(
          `페이지 회전 실패: 페이지 ${page.sourcePageIndex + 1} - ${String(error)}`
        );
      }
    },
    [fileId, page.id, page.sourcePageIndex, filePath, rotatePage]
  );

  return { handleRotateCw, handleRotateCcw };
}
