import {
  forwardRef,
  useCallback,
  useRef,
  type HTMLAttributes
} from "react";
import { Virtuoso } from "react-virtuoso";
import { Loader2 } from "lucide-react";
import { PreviewPageItem } from "./preview-page-item";
import { usePreviewPages } from "../model/use-preview-pages";
import { PREVIEW_CONFIG } from "@/renderer/shared/constants/preview";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";
import { cn } from "@/renderer/shared/lib/utils";

/**
 * 고정 아이템 높이 설정
 * - A4 비율(210x297) 기준으로 고정값 사용
 * - 동적 계산을 제거하여 스크롤 점프 방지
 */
const FIXED_ITEM_HEIGHT = 900;

/**
 * 커스텀 스크롤러 - 컴포넌트 외부에 정의하여 참조 안정성 확보
 */
const CustomScroller = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, style, ...props }, ref) => (
  <div
    ref={ref}
    {...props}
    className={cn(
      "scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent pr-4",
      className
    )}
    style={{
      ...style,
      scrollbarGutter: "stable both-edges"
    }}
  />
));
CustomScroller.displayName = "CustomScroller";

interface VirtuosoPreviewListProps {
  document: PdfDocument;
  isOpen: boolean;
}

/**
 * 가상화 스크롤 기반 전체 페이지 미리보기 목록
 * - react-virtuoso를 사용하여 대용량 PDF 지원
 * - 뷰포트 내 페이지만 렌더링
 * - 고정 높이로 스크롤 안정성 확보
 */
export function VirtuosoPreviewList({
  document,
  isOpen
}: VirtuosoPreviewListProps) {
  const { totalPages, getPageData, loadPage, isDocumentLoading, error } =
    usePreviewPages({
      pdfDocument: document,
      isOpen
    });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 페이지 아이템 렌더링
  // PDF 파일 자체가 회전되므로 CSS 회전 불필요
  const renderItem = useCallback(
    (index: number) => {
      const pageData = getPageData(index);

      return (
        <PreviewPageItem
          pageIndex={index}
          pageData={pageData}
          onLoadPage={loadPage}
          itemHeight={FIXED_ITEM_HEIGHT}
        />
      );
    },
    [getPageData, loadPage]
  );

  // PDF 로딩 중
  if (isDocumentLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground flex flex-col items-center gap-2">
          <Loader2 size={32} className="animate-spin" />
          <span className="text-sm">PDF 로딩 중...</span>
        </div>
      </div>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-center">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // 페이지가 없는 경우
  if (totalPages === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-center">
          <p>페이지가 없습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full">
      <Virtuoso
        style={{ height: "100%", width: "100%" }}
        totalCount={totalPages}
        overscan={PREVIEW_CONFIG.OVERSCAN}
        itemContent={renderItem}
        computeItemKey={(index) => document.pages[index]?.id ?? index}
        fixedItemHeight={FIXED_ITEM_HEIGHT}
        className="left-1/2 max-w-5xl -translate-x-1/2"
        components={{ Scroller: CustomScroller }}
      />
    </div>
  );
}
