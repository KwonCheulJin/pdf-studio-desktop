import { useCallback } from "react";
import { toast } from "sonner";
import { useErrorSnapshot } from "@kwoncheulJin/error-snapshot";
import { useMergeStore } from "@/renderer/entities/merge-plan";
import {
  getPlatform,
  LOG_LEVEL,
  PlatformError
} from "@/renderer/shared/platform";
import { getFileBaseName } from "@/renderer/shared/lib/file-utils";
import { getErrorSnapshot } from "@/renderer/shared/lib/error-snapshot";
import { openDocuments } from "../lib/open-documents";

interface UseAddFilesResult {
  handleAddFiles: () => Promise<void>;
}

/**
 * 파일 다이얼로그를 통한 파일 추가를 관리하는 훅
 * - AppToolbar와 MergeWorkspace에서 공통으로 사용
 * - TIF/TIFF 파일은 플랫폼이 추가 시점에 PDF로 변환한다
 */
export function useAddFiles(): UseAddFilesResult {
  const addFiles = useMergeStore((state) => state.addFiles);
  const { captureError } = useErrorSnapshot(getErrorSnapshot());

  const handleAddFiles = useCallback(async () => {
    const platform = getPlatform();
    const filePaths = await platform.pickFiles();
    if (filePaths.length === 0) return;

    const { documents, failures } = await openDocuments({ paths: filePaths });

    for (const { sourcePath: filePath, error } of failures) {
      const fileName = getFileBaseName(filePath);
      platform.log({
        level: LOG_LEVEL.ERROR,
        message: `파일 로드 실패: ${filePath} - ${error.message}`
      });
      toast.error(`"${fileName}" 파일을 열 수 없습니다.`, {
        description: error.message
      });
      // Error Snapshot 캡처 (파일 로드 실패 정보 포함)
      captureError(new PlatformError(error), {
        source: "file-load",
        filePath,
        fileName
      });
    }

    addFiles(documents);
  }, [addFiles, captureError]);

  return { handleAddFiles };
}
