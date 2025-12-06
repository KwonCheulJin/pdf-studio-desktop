import { useCallback } from "react";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import { createPdfDocument } from "@/renderer/shared/model/pdf-document";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";

interface UseAddFilesResult {
  handleAddFiles: () => Promise<void>;
}

/**
 * 파일 다이얼로그를 통한 파일 추가를 관리하는 훅
 * - AppToolbar와 MergeWorkspace에서 공통으로 사용
 */
export function useAddFiles(): UseAddFilesResult {
  const addFiles = useMergeStore((state) => state.addFiles);

  const handleAddFiles = useCallback(async () => {
    const filePaths = await ipcClient.dialog.open();
    if (filePaths.length === 0) return;

    const documents = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const pdfInfo = await ipcClient.meta.getPdfInfo(filePath);
          return createPdfDocument(filePath, pdfInfo.pageCount, pdfInfo.title);
        } catch {
          // 메타데이터 가져오기 실패 시 기본값 사용
          return createPdfDocument(filePath, 1);
        }
      })
    );

    addFiles(documents);
  }, [addFiles]);

  return { handleAddFiles };
}
