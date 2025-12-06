import { useEffect, useState } from "react";
import { generatePreview } from "@/renderer/shared/lib/pdf-thumbnail";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";
import { FILE_EXTENSIONS } from "@/renderer/shared/constants/app";

interface UsePreviewLoaderResult {
  previewUrl: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * PDF 미리보기 로드를 관리하는 훅
 * - 비동기 미리보기 생성
 * - 취소 처리
 * - 로딩/에러 상태 관리
 */
export function usePreviewLoader(
  isOpen: boolean,
  document: PdfDocument | null
): UsePreviewLoaderResult {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !document) {
      setPreviewUrl(null);
      setError(null);
      return;
    }

    const isPdf = document.path.toLowerCase().endsWith(FILE_EXTENSIONS.PDF);
    if (!isPdf) {
      setError("PDF 파일만 미리보기가 가능합니다.");
      return;
    }

    let isCancelled = false;

    const loadPreview = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await generatePreview(document.path);
        if (!isCancelled) {
          setPreviewUrl(result.dataUrl);
        }
      } catch {
        if (!isCancelled) {
          setError("미리보기를 불러올 수 없습니다.");
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
  }, [isOpen, document]);

  return { previewUrl, isLoading, error };
}
