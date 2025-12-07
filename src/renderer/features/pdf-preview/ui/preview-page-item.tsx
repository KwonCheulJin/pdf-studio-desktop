import { useEffect } from "react";
import { Loader2, FileText } from "lucide-react";

interface PageData {
  dataUrl: string | null;
  isLoading: boolean;
}

interface PreviewPageItemProps {
  pageIndex: number;
  pageData: PageData;
  itemHeight: number;
  onLoadPage: (pageIndex: number) => void;
}

/**
 * 미리보기 모달 내 개별 페이지 아이템
 * - Virtuoso와 연동되어 뷰포트 진입 시 로드
 * - 로딩/에러/렌더링 상태 표시
 * - 고정 높이로 스크롤 안정성 확보
 */
export function PreviewPageItem({
  pageIndex,
  pageData,
  itemHeight,
  onLoadPage
}: PreviewPageItemProps) {
  // 뷰포트 진입 시 로드 요청
  useEffect(() => {
    if (!pageData.dataUrl && !pageData.isLoading) {
      onLoadPage(pageIndex);
    }
  }, [pageIndex, pageData.dataUrl, pageData.isLoading, onLoadPage]);

  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ height: itemHeight }}
    >
      {/* 페이지 컨테이너 - 고정 높이에서 이미지 영역 확보 */}
      <div className="bg-muted relative flex h-[calc(100%-48px)] w-full max-w-3xl items-center justify-center overflow-hidden shadow-md">
        {/* 로딩 상태 */}
        {pageData.isLoading && (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <Loader2 size={32} className="animate-spin" />
            <span className="text-sm">페이지 로딩 중...</span>
          </div>
        )}

        {/* 이미지 렌더링 */}
        {pageData.dataUrl && (
          <img
            src={pageData.dataUrl}
            alt={`페이지 ${pageIndex + 1}`}
            className="h-full w-auto object-contain"
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
