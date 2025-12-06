import { useEffect, useRef, useCallback } from "react";
import { generateAllPageThumbnails } from "@/renderer/shared/lib/pdf-thumbnail";
import { useMergeStore } from "@/renderer/shared/model/merge-store";

interface UsePdfThumbnailsOptions {
  fileId: string;
  filePath: string;
  pageCount: number;
  enabled?: boolean;
}

interface UsePdfThumbnailsResult {
  isLoading: boolean;
  error: Error | null;
  generateThumbnails: () => Promise<void>;
}

export function usePdfThumbnails({
  fileId,
  filePath,
  pageCount,
  enabled = true
}: UsePdfThumbnailsOptions): UsePdfThumbnailsResult {
  const isLoadingRef = useRef(false);
  const errorRef = useRef<Error | null>(null);
  const hasGeneratedRef = useRef(false);
  const updatePageThumbnail = useMergeStore(
    (state) => state.updatePageThumbnail
  );
  const file = useMergeStore((state) =>
    state.files.find((candidateFile) => candidateFile.id === fileId)
  );

  const generateThumbnails = useCallback(async () => {
    // PDF 파일만 처리
    const isPdf = filePath.toLowerCase().endsWith(".pdf");
    if (!isPdf || !enabled || isLoadingRef.current || hasGeneratedRef.current) {
      return;
    }

    // 이미 모든 썸네일이 있는지 확인
    const allThumbnailsExist = file?.pages.every((page) => page.thumbnailUrl);
    if (allThumbnailsExist) {
      hasGeneratedRef.current = true;
      return;
    }

    isLoadingRef.current = true;
    errorRef.current = null;

    try {
      await generateAllPageThumbnails({
        filePath,
        pageCount,
        onPageGenerated: (pageIndex, dataUrl) => {
          // 각 페이지 썸네일 생성 완료 시 즉시 스토어 업데이트
          const page = file?.pages[pageIndex];
          if (page) {
            updatePageThumbnail(fileId, page.id, dataUrl);
          }
        }
      });
      hasGeneratedRef.current = true;
    } catch (err) {
      errorRef.current =
        err instanceof Error ? err : new Error("썸네일 생성 실패");
    } finally {
      isLoadingRef.current = false;
    }
  }, [fileId, filePath, pageCount, enabled, file, updatePageThumbnail]);

  // enabled가 true가 되면 자동으로 썸네일 생성
  useEffect(() => {
    if (enabled && !hasGeneratedRef.current) {
      generateThumbnails();
    }
  }, [enabled, generateThumbnails]);

  // fileId가 변경되면 리셋
  useEffect(() => {
    hasGeneratedRef.current = false;
  }, [fileId]);

  return {
    isLoading: isLoadingRef.current,
    error: errorRef.current,
    generateThumbnails
  };
}
