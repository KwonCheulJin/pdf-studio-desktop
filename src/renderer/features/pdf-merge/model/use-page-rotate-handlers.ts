import { useCallback } from "react";
import {
  PAGE_ROTATION,
  useMergeStore,
  type PdfPage
} from "@/renderer/entities/merge-plan";

interface UsePageRotateHandlersParams {
  fileId: string;
  page: PdfPage;
}

interface UsePageRotateHandlersResult {
  handleRotateCw: (event: React.MouseEvent) => void;
  handleRotateCcw: (event: React.MouseEvent) => void;
}

/**
 * 개별 페이지 카드의 시계 방향/반시계 방향 회전 핸들러
 * PageThumbnail, ExpandedPageCard 등에서 공통으로 사용
 * 회전은 스토어에만 기록하고 병합 요청에 담는다(원본 파일은 바꾸지 않는다).
 */
export function usePageRotateHandlers({
  fileId,
  page
}: UsePageRotateHandlersParams): UsePageRotateHandlersResult {
  const rotatePage = useMergeStore((state) => state.rotatePage);

  const handleRotateCw = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      rotatePage(fileId, page.id, PAGE_ROTATION.DEG_90);
    },
    [fileId, page.id, rotatePage]
  );

  const handleRotateCcw = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      rotatePage(fileId, page.id, PAGE_ROTATION.DEG_270);
    },
    [fileId, page.id, rotatePage]
  );

  return { handleRotateCw, handleRotateCcw };
}
