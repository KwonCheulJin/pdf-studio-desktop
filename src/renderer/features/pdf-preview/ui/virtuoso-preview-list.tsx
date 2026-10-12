import { useCallback, useRef, type HTMLAttributes, type Ref } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  PAGE_ROTATION,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import { cn } from "@/renderer/shared/lib/utils";
import { PREVIEW_CONFIG } from "../config/preview";
import { PreviewPageItem } from "./preview-page-item";

/**
 * 고정 아이템 높이 설정
 * - A4 비율(210x297) 기준으로 고정값 사용
 * - 동적 계산을 제거하여 스크롤 점프 방지
 */
const FIXED_ITEM_HEIGHT = 900;

/**
 * 커스텀 스크롤러 - 컴포넌트 외부에 정의하여 참조 안정성 확보
 * React 19: ref를 일반 prop으로 전달
 */
interface CustomScrollerProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

function CustomScroller({
  className,
  style,
  ref,
  ...props
}: CustomScrollerProps) {
  return (
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
  );
}

interface VirtuosoPreviewListProps {
  document: PdfDocument;
}

/**
 * 가상화 스크롤 기반 전체 페이지 미리보기 목록
 * - react-virtuoso를 사용하여 대용량 PDF 지원
 * - 뷰포트 내 페이지만 렌더링
 * - 고정 높이로 스크롤 안정성 확보
 */
export function VirtuosoPreviewList({ document }: VirtuosoPreviewListProps) {
  // 그룹 미리보기면 document.pages가 그 그룹 페이지만 담고 있다.
  const totalPages = document.pages.length;
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 페이지 아이템 렌더링. 스토어의 절대 회전으로 그린다(원본 파일은 회전하지 않는다).
  const renderItem = useCallback(
    (index: number) => (
      <PreviewPageItem
        filePath={document.path}
        pageIndex={index}
        sourcePageIndex={document.pages[index]?.sourcePageIndex ?? index}
        rotation={document.pages[index]?.rotation ?? PAGE_ROTATION.DEG_0}
        itemHeight={FIXED_ITEM_HEIGHT}
      />
    ),
    [document.path, document.pages]
  );

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
