import { useEffect, useState } from "react";
import { Loader2, FileText } from "lucide-react";
import { generateThumbnail } from "@/renderer/shared/lib/pdf-thumbnail";
import { PREVIEW_CONFIG } from "@/renderer/shared/constants/preview";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

interface SinglePagePreviewProps {
  document: PdfDocument;
  pageIndex: number;
}

/**
 * 단일 페이지 미리보기 컴포넌트
 * - 펼친 페이지 카드에서 클릭 시 표시
 * - 해당 페이지만 고해상도로 렌더링
 * - 회전은 PDF 파일에 직접 적용되므로 CSS 회전 불필요
 */
export function SinglePagePreview({
  document,
  pageIndex
}: SinglePagePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 페이지 회전 상태 (rotation 변경 시 이미지 재생성 트리거용)
  const page = document.pages[pageIndex];
  const rotation = page?.rotation ?? 0;

  useEffect(() => {
    let isCancelled = false;

    const loadPreview = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await generateThumbnail({
          filePath: document.path,
          pageNumber: pageIndex + 1, // 1-based
          scale: PREVIEW_CONFIG.SCALE
        });

        if (!isCancelled) {
          setPreviewUrl(result.dataUrl);
        }
      } catch {
        if (!isCancelled) {
          setError("페이지를 불러올 수 없습니다.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPreview();

    return () => {
      isCancelled = true;
    };
  }, [document.path, pageIndex, rotation]);

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
        {error && (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <FileText size={32} />
            <span className="text-sm">{error}</span>
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
