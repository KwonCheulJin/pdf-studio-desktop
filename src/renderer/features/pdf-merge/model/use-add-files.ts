import { useCallback } from "react";
import {
  useMergeStore,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import {
  getPlatform,
  PlatformError,
  toPlatformError
} from "@/renderer/shared/platform";
import { reportError } from "@/renderer/shared/lib/error-report";
import { notifyFailure } from "../lib/notify-failure";
import { openDocuments, type OpenDocumentsResult } from "../lib/open-documents";

type OpenPaths = (paths: string[]) => Promise<PdfDocument[]>;

const ADD_FILES_FAILED_TITLE = "파일을 추가하지 못했어요.";

/**
 * 경로를 열어 문서로 만든다. 열지 못한 파일은 작업 공간에 넣지 않고(B16)
 * 파일마다 로그·토스트·오류 보고로 알린다. 요청 자체가 실패하면 빈 목록이다.
 */
function useOpenPaths(): OpenPaths {
  return useCallback(async (paths) => {
    let opened: OpenDocumentsResult;
    try {
      opened = await openDocuments({ paths });
    } catch (error) {
      notifyFailure({
        title: ADD_FILES_FAILED_TITLE,
        error: toPlatformError(error),
        context: `파일 열기 요청 실패: ${paths.join(", ")}`
      });
      return [];
    }

    for (const { sourcePath: filePath, error } of opened.failures) {
      const fileName = await getPlatform().fileStem(filePath);
      const platformError = new PlatformError(error);
      notifyFailure({
        title: `"${fileName}" 파일을 열지 못해 건너뛰었어요.`,
        error: platformError,
        context: `파일 로드 실패: ${filePath}`
      });
      // 오류 보고는 보내기 전에 경로를 확장자만 남기고 지운다.
      void reportError({
        error: platformError,
        meta: { source: "file-load", code: platformError.code, filePath }
      });
    }

    return opened.documents;
  }, []);
}

interface UseAddFilesResult {
  /** 작업 공간에 넣은 문서 수. 다이얼로그를 취소했거나 모두 열지 못하면 0 */
  handleAddFiles: () => Promise<number>;
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
    let filePaths: string[];
    try {
      filePaths = await getPlatform().pickFiles();
    } catch (error) {
      notifyFailure({
        title: ADD_FILES_FAILED_TITLE,
        error: toPlatformError(error),
        context: "파일 선택 다이얼로그 실패"
      });
      return 0;
    }
    if (filePaths.length === 0) return 0;

    const documents = await openPaths(filePaths);
    addFiles(documents);
    return documents.length;
  }, [addFiles, openPaths]);

  return { handleAddFiles };
}

export interface AddDroppedFilesParams {
  paths: string[];
  /** 병합 순서에서 이 페이지 앞에 넣는다. `null`이면 맨 끝 */
  targetPageId: string | null;
}

/** 창에 드롭한 파일을 열어 드롭한 자리에 넣는다. 넣은 문서 수를 돌려준다. */
export function useAddDroppedFiles(): (
  params: AddDroppedFilesParams
) => Promise<number> {
  const addFiles = useMergeStore((state) => state.addFiles);
  const insertFileAtPosition = useMergeStore(
    (state) => state.insertFileAtPosition
  );
  const openPaths = useOpenPaths();

  return useCallback(
    async ({ paths, targetPageId }) => {
      const documents = await openPaths(paths);
      addFiles(documents);
      if (targetPageId !== null) {
        // 같은 페이지 앞에 차례로 넣으면 드롭한 순서가 유지된다.
        for (const document of documents) {
          insertFileAtPosition({ fileId: document.id, targetPageId });
        }
      }
      return documents.length;
    },
    [addFiles, insertFileAtPosition, openPaths]
  );
}
