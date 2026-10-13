import { formatPageRange } from "@/renderer/shared/lib/page-range-format";

interface FormatDocumentCaptionParams {
  /** 카드에 든(삭제되지 않은) 원본 페이지 번호 (1부터) */
  activePageNumbers: number[];
  /** 원본 문서의 전체 페이지 수 */
  totalPageCount: number;
}

/**
 * 접힌 문서 카드 아래 쪽수 표기(시안 2·6). 문서 전체면 "5페이지",
 * 일부(삭제·나뉜 그룹)면 "4페이지 (1-2, 4-5)"처럼 남은 쪽 범위를 붙인다.
 */
export function formatDocumentCaption({
  activePageNumbers,
  totalPageCount
}: FormatDocumentCaptionParams): string {
  const count = activePageNumbers.length;
  const isWholeDocument = count === totalPageCount;
  if (isWholeDocument || count === 0) {
    return `${count}페이지`;
  }
  return `${count}페이지 (${formatPageRange(activePageNumbers)})`;
}
