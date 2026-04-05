import { useCallback } from "react";
import { toast } from "sonner";
import { useErrorSnapshot } from "@kwoncheulJin/error-snapshot";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import { createPdfDocument } from "@/renderer/shared/model/pdf-document";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { isTiffFile, getFileBaseName } from "@/renderer/shared/lib/file-utils";
import { getErrorSnapshot } from "@/renderer/shared/lib/error-snapshot";

interface UseAddFilesResult {
  handleAddFiles: () => Promise<void>;
}

/**
 * 파일 다이얼로그를 통한 파일 추가를 관리하는 훅
 * - AppToolbar와 MergeWorkspace에서 공통으로 사용
 * - TIF/TIFF 파일은 추가 시점에 PDF로 변환 후 저장
 */
export function useAddFiles(): UseAddFilesResult {
  const addFiles = useMergeStore((state) => state.addFiles);
  const { captureError } = useErrorSnapshot(getErrorSnapshot());

  const handleAddFiles = useCallback(async () => {
    const filePaths = await ipcClient.dialog.open();
    if (filePaths.length === 0) return;

    const documentsOrNull = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          if (isTiffFile(filePath)) {
            const result = await ipcClient.convert.tiff({ tiffPath: filePath });
            return createPdfDocument(
              result.outputPdfPath,
              result.pageCount,
              getFileBaseName(filePath)
            );
          }
          const pdfInfo = await ipcClient.meta.getPdfInfo(filePath);
          return createPdfDocument(
            filePath,
            pdfInfo.pageCount,
            pdfInfo.title,
            pdfInfo.pageRotations
          );
        } catch (error) {
          const fileName = getFileBaseName(filePath);
          ipcClient.log.error(`파일 로드 실패: ${filePath} - ${String(error)}`);
          toast.error(`"${fileName}" 파일을 열 수 없습니다.`, {
            description: String(error)
          });
          // Error Snapshot 캡처 (파일 로드 실패 정보 포함)
          const err = error instanceof Error ? error : new Error(String(error));
          captureError(err, { source: "file-load", filePath, fileName });
          return null;
        }
      })
    );

    const documents = documentsOrNull.filter(
      (doc): doc is NonNullable<typeof doc> => doc !== null
    );

    addFiles(documents);
  }, [addFiles]);

  return { handleAddFiles };
}
