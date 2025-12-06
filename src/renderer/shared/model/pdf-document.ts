// PDF 문서 도메인 타입

export interface PdfPage {
  index: number; // 0-based page index
  thumbnailUrl?: string; // data URL 또는 blob URL
}

export interface PdfDocument {
  id: string;
  path: string;
  name: string;
  pageCount: number;
  pages: PdfPage[];
  title?: string;
}

// 새 PdfDocument 생성 헬퍼
export function createPdfDocument(
  path: string,
  pageCount: number,
  title?: string
): PdfDocument {
  const name = path.split('/').pop() ?? path;
  const pages: PdfPage[] = Array.from({ length: pageCount }, (_, index) => ({
    index,
  }));

  return {
    id: crypto.randomUUID(),
    path,
    name,
    pageCount,
    pages,
    title,
  };
}
