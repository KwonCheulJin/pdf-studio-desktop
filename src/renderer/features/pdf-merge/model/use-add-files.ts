import { useCallback } from "react";
import { toast } from "sonner";
import { useErrorSnapshot } from "@kwoncheulJin/error-snapshot";
import {
  useMergeStore,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import {
  getPlatform,
  LOG_LEVEL,
  PlatformError
} from "@/renderer/shared/platform";
import { getFileBaseName } from "@/renderer/shared/lib/file-utils";
import { getErrorSnapshot } from "@/renderer/shared/lib/error-snapshot";
import { openDocuments } from "../lib/open-documents";

type OpenPaths = (paths: string[]) => Promise<PdfDocument[]>;

/** 경로를 열어 문서로 만든다. 열지 못한 파일은 로그·토스트·에러 스냅샷으로 알린다. */
function useOpenPaths(): OpenPaths {
  const { captureError } = useErrorSnapshot(getErrorSnapshot());

  return useCallback(
    async (paths) => {
      const platform = getPlatform();
      const { documents, failures } = await openDocuments({ paths });

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

      return documents;
    },
    [captureError]
  );
}

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
  const openPaths = useOpenPaths();

  const handleAddFiles = useCallback(async () => {
    const filePaths = await getPlatform().pickFiles();
    if (filePaths.length === 0) return;

    addFiles(await openPaths(filePaths));
  }, [addFiles, openPaths]);

  return { handleAddFiles };
}

export interface AddDroppedFilesParams {
  paths: string[];
  /** 병합 순서에서 이 페이지 앞에 넣는다. `null`이면 맨 끝 */
  targetPageId: string | null;
}

/** 창에 드롭한 파일을 열어 드롭한 자리에 넣는다. */
export function useAddDroppedFiles(): (
  params: AddDroppedFilesParams
) => Promise<void> {
  const addFiles = useMergeStore((state) => state.addFiles);
  const insertFileAtPosition = useMergeStore(
    (state) => state.insertFileAtPosition
  );
  const openPaths = useOpenPaths();

  return useCallback(
    async ({ paths, targetPageId }) => {
      const documents = await openPaths(paths);
      addFiles(documents);
      if (targetPageId === null) return;
      // 같은 페이지 앞에 차례로 넣으면 드롭한 순서가 유지된다.
      for (const document of documents) {
        insertFileAtPosition({ fileId: document.id, targetPageId });
      }
    },
    [addFiles, insertFileAtPosition, openPaths]
  );
}
