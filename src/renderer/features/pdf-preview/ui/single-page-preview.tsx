import { Loader2, FileText } from "lucide-react";
import {
  PAGE_ROTATION,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import { useRenderedPage } from "@/renderer/shared/lib/pdfjs";
import { PREVIEW_CONFIG } from "../config/preview";

interface SinglePagePreviewProps {
  document: PdfDocument;
  /** 0부터 센 원본 페이지 번호 */
  pageIndex: number;
}

/**
 * 단일 페이지 미리보기 컴포넌트
 * - 펼친 페이지 카드에서 클릭 시 표시
 * - 해당 페이지만 고해상도로 렌더링(PDF `/Rotate`는 적용하지 않는다)
 */
export function SinglePagePreview({
  document,
  pageIndex
}: SinglePagePreviewProps) {
  const {
    url: previewUrl,
    isLoading,
    hasError
  } = useRenderedPage({
    path: document.path,
    pageIndex,
    scale: PREVIEW_CONFIG.SCALE,
    rotation: PAGE_ROTATION.DEG_0,
    isEnabled: true
  });

  return (
    <div className="flex flex-col items-center pr-4">
      {/* 페이지 컨테이너 */}
      <div className="bg-muted relative flex h-full w-full items-center justify-center overflow-hidden shadow-md">
        {/* 로딩 상태 */}
        {isLoading && (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <Loader2 size={32} className="animate-spin" />
            <span className="text-sm">페이지 로딩 중...</span>
          </div>
        )}

        {/* 에러 상태 */}
        {hasError && (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <FileText size={32} />
            <span className="text-sm">페이지를 불러올 수 없습니다.</span>
          </div>
        )}

        {/* 이미지 렌더링 - PDF 파일 자체가 회전되므로 CSS 회전 불필요 */}
        {previewUrl && !isLoading && (
          <img
            src={previewUrl}
            alt={`${document.name} 페이지 ${pageIndex + 1}`}
            className="max-h-[70vh] max-w-full object-contain"
          />
        )}
      </div>
    </div>
  );
}
