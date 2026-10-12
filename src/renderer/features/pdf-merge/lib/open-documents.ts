import type { OpenedFile } from "@/renderer/shared/api/bindings";
import {
  createPdfDocument,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import { getPlatform } from "@/renderer/shared/platform";

type OpenedFileFailure = Extract<OpenedFile, { status: "error" }>;

interface OpenDocumentsParams {
  paths: string[];
}

export interface OpenDocumentsResult {
  documents: PdfDocument[];
  failures: OpenedFileFailure[];
}

/**
 * 경로들을 열어 PdfDocument로 만든다.
 * 확장자 판별·TIFF 변환·정보 조회는 플랫폼(`openFiles`)이 하고, 실패한 파일은 따로 돌려준다.
 */
export async function openDocuments({
  paths
}: OpenDocumentsParams): Promise<OpenDocumentsResult> {
  const openedFiles = await getPlatform().openFiles(paths);

  const documents = openedFiles.flatMap((openedFile) =>
    openedFile.status === "ok"
      ? [
          createPdfDocument({
            path: openedFile.pdfPath,
            // TIFF는 변환 결과가 캐시 폴더의 고유 이름이라 화면 이름은 displayName을 쓴다.
            name: openedFile.displayName,
            pageCount: openedFile.info.pageCount,
            title: openedFile.info.title ?? undefined,
            pageRotations: openedFile.info.pages.map((page) => page.rotation)
          })
        ]
      : []
  );
  const failures = openedFiles.filter(
    (openedFile): openedFile is OpenedFileFailure =>
      openedFile.status === "error"
  );

  return { documents, failures };
}
