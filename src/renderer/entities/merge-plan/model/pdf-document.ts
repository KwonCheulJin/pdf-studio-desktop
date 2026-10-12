// PDF 문서 도메인 타입

import type { PageRotation } from "../config/page-rotation";

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
}

export interface PdfDocument {
  id: string;
  path: string;
  name: string;
  pageCount: number; // 원본 페이지 수 (삭제된 것 포함)
  pages: PdfPage[];
  title?: string;
}

interface CreatePdfDocumentParams {
  path: string;
  /** 화면 이름. 경로에서 자르지 않고 플랫폼이 준 이름(`displayName`·`fileName`)을 쓴다. */
  name: string;
  pageCount: number;
  title?: string;
  /** 쪽별 원본 회전. 0·90·180·270이 아니면 0 */
  pageRotations?: number[];
}

// 새 PdfDocument 생성 헬퍼
export function createPdfDocument({
  path,
  name,
  pageCount,
  title,
  pageRotations
}: CreatePdfDocumentParams): PdfDocument {
  const documentId = crypto.randomUUID();
  const pages: PdfPage[] = Array.from({ length: pageCount }, (_, index) => {
    const rawRotation = pageRotations?.[index] ?? 0;
    const rotation = (
      rawRotation === 0 ||
      rawRotation === 90 ||
      rawRotation === 180 ||
      rawRotation === 270
        ? rawRotation
        : 0
    ) as PageRotation;
    return {
      id: crypto.randomUUID(),
      sourceDocumentId: documentId,
      sourcePageIndex: index,
      rotation,
      isDeleted: false
    };
  });

  return {
    id: documentId,
    path,
    name,
    pageCount,
    pages,
    title
  };
}
