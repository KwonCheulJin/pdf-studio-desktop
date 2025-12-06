import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import {
  createPdfDocument,
  type PdfDocument
} from "@/renderer/shared/model/pdf-document";

/**
 * 드롭된 파일들을 PdfDocument로 변환
 * - IPC를 통해 파일 경로와 PDF 메타데이터 가져오기
 * - 실패한 파일은 기본값(pageCount: 1)으로 생성
 * - 병렬 처리
 *
 * @param files 드롭된 File 객체 배열
 * @returns PdfDocument 배열 (null 제외)
 */
export async function loadDroppedFiles(files: File[]): Promise<PdfDocument[]> {
  const documentsOrNull = await Promise.all(
    files.map(async (file) => {
      const filePath = ipcClient.file.getPath(file);
      if (!filePath) {
        console.warn("파일 경로를 가져올 수 없습니다:", file.name);
        return null;
      }
      try {
        const pdfInfo = await ipcClient.meta.getPdfInfo(filePath);
        return createPdfDocument(filePath, pdfInfo.pageCount, pdfInfo.title);
      } catch {
        // 메타데이터 가져오기 실패 시 기본값 사용
        return createPdfDocument(filePath, 1);
      }
    })
  );

  return documentsOrNull.filter(
    (doc): doc is NonNullable<typeof doc> => doc !== null
  );
}
