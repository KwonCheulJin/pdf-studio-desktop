import { useEffect } from "react";
import { Loader2, FileText } from "lucide-react";

interface PageDimensions {
  width: number;
  height: number;
}

interface PageData {
  dataUrl: string | null;
  dimensions: PageDimensions | null;
  isLoading: boolean;
}

interface PreviewPageItemProps {
  pageIndex: number;
  pageData: PageData;
  onLoadPage: (pageIndex: number) => void;
}

/**
 * 미리보기 모달 내 개별 페이지 아이템
 * - Virtuoso와 연동되어 뷰포트 진입 시 로드
 * - 로딩/에러/렌더링 상태 표시
 * - PDF 파일 자체가 회전되므로 CSS 회전 불필요
 */
export function PreviewPageItem({
  pageIndex,
  pageData,
  onLoadPage
}: PreviewPageItemProps) {
  // 뷰포트 진입 시 로드 요청
  useEffect(() => {
    if (!pageData.dataUrl && !pageData.isLoading) {
      onLoadPage(pageIndex);
    }
  }, [pageIndex, pageData.dataUrl, pageData.isLoading, onLoadPage]);

  return (
    <div className="flex flex-col items-center py-6">
      {/* 페이지 컨테이너 */}
      <div className="bg-muted relative flex h-full w-full items-center justify-center overflow-hidden px-4 py-6 shadow-md">
        {/* 로딩 상태 */}
        {pageData.isLoading && (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <Loader2 size={32} className="animate-spin" />
            <span className="text-sm">페이지 로딩 중...</span>
          </div>
        )}

        {/* 이미지 렌더링 - PDF 파일 자체가 회전되므로 CSS 회전 불필요 */}
        {pageData.dataUrl && (
          <img
            src={pageData.dataUrl}
            alt={`페이지 ${pageIndex + 1}`}
            className="w-full max-w-none object-contain"
          />
        )}

        {/* 아직 로드되지 않음 */}
        {!pageData.dataUrl && !pageData.isLoading && (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <FileText size={32} />
            <span className="text-sm">페이지 {pageIndex + 1}</span>
          </div>
        )}
      </div>

      {/* 페이지 번호 */}
      <div className="text-muted-foreground mt-2 text-sm">{pageIndex + 1}</div>
    </div>
  );
}
