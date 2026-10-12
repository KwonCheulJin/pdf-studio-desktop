import { Loader2, FileText } from "lucide-react";
import type { PageRotation } from "@/renderer/entities/merge-plan";
import { useRenderedPage } from "@/renderer/shared/lib/pdfjs";
import { PREVIEW_CONFIG } from "../config/preview";

interface PreviewPageItemProps {
  filePath: string;
  /** 목록 안 순서(0부터) */
  pageIndex: number;
  /** 0부터 센 원본 페이지 번호 */
  sourcePageIndex: number;
  /** 스토어의 절대 회전. PDF `/Rotate` 대신 이 값으로 그린다. */
  rotation: PageRotation;
  itemHeight: number;
}

/**
 * 미리보기 모달 내 개별 페이지 아이템
 * - Virtuoso가 화면 근처 아이템만 마운트하므로 마운트된 동안만 렌더 결과를 잡는다
 * - 로딩/에러/렌더링 상태 표시
 * - 고정 높이로 스크롤 안정성 확보
 */
export function PreviewPageItem({
  filePath,
  pageIndex,
  sourcePageIndex,
  rotation,
  itemHeight
}: PreviewPageItemProps) {
  const { url, isLoading, hasError } = useRenderedPage({
    path: filePath,
    pageIndex: sourcePageIndex,
    scale: PREVIEW_CONFIG.SCALE,
    rotation,
    isEnabled: true
  });

  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ height: itemHeight }}
    >
      {/* 페이지 컨테이너 - 고정 높이에서 이미지 영역 확보 */}
      <div className="bg-muted relative flex h-[calc(100%-48px)] w-full max-w-3xl items-center justify-center overflow-hidden shadow-md">
        {/* 로딩 상태 */}
        {isLoading && (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <Loader2 size={32} className="animate-spin" />
            <span className="text-sm">페이지 로딩 중...</span>
          </div>
        )}

        {/* 이미지 렌더링 */}
        {url && (
          <img
            src={url}
            alt={`페이지 ${pageIndex + 1}`}
            className="h-full w-auto object-contain"
          />
        )}

        {/* 렌더 실패 */}
        {hasError && (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <FileText size={32} />
            <span className="text-sm">페이지를 불러올 수 없습니다.</span>
          </div>
        )}
      </div>

      {/* 페이지 번호 */}
      <div className="text-muted-foreground mt-2 text-sm">{pageIndex + 1}</div>
    </div>
  );
}
