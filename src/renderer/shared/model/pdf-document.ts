// PDF 문서 도메인 타입

import { PAGE_ROTATION, type PageRotation } from "../constants/page-state";

/**
 * 병합 순서 아이템
 * mergeOrder 배열에서 사용되며, 페이지 레벨 순서를 명시적으로 관리
 */
export interface MergeOrderItem {
  fileId: string;
  pageId: string;
}

export interface PdfPage {
  id: string; // 고유 ID (파일간 이동 추적용)
  sourceDocumentId: string; // 원본 파일 ID
  sourcePageIndex: number; // 원본 페이지 인덱스 (0-based)
  rotation: PageRotation; // 0, 90, 180, 270
  isDeleted: boolean; // soft delete 플래그
  thumbnailUrl?: string; // data URL 또는 blob URL
}

export interface PdfDocument {
  id: string;
  path: string;
  name: string;
  pageCount: number; // 원본 페이지 수 (삭제된 것 포함)
  pages: PdfPage[];
  title?: string;
}

// 새 PdfDocument 생성 헬퍼
export function createPdfDocument(
  path: string,
  pageCount: number,
  title?: string
): PdfDocument {
  const documentId = crypto.randomUUID();
  const name = path?.split("/").pop() ?? path ?? "Unknown";
  const pages: PdfPage[] = Array.from({ length: pageCount }, (_, index) => ({
    id: crypto.randomUUID(),
    sourceDocumentId: documentId,
    sourcePageIndex: index,
    rotation: PAGE_ROTATION.DEG_0,
    isDeleted: false
  }));

  return {
    id: documentId,
    path,
    name,
    pageCount,
    pages,
    title
  };
}
