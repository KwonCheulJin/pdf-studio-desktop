import { useState, useEffect } from "react";
import { generateThumbnail } from "@/renderer/shared/lib/pdf-thumbnail";

interface UsePdfThumbnailOptions {
  filePath: string;
  enabled?: boolean;
}

interface UsePdfThumbnailResult {
  thumbnailUrl: string | null;
  isLoading: boolean;
  error: Error | null;
}

export function usePdfThumbnail({
  filePath,
  enabled = true
}: UsePdfThumbnailOptions): UsePdfThumbnailResult {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !filePath) {
      return;
    }

    // PDF 파일만 썸네일 생성
    const isPdf = filePath.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return;
    }

    let isCancelled = false;

    const loadThumbnail = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await generateThumbnail({ filePath });
        if (!isCancelled) {
          setThumbnailUrl(result.dataUrl);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err : new Error("썸네일 생성 실패"));
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadThumbnail();

    return () => {
      isCancelled = true;
    };
  }, [filePath, enabled]);

  return { thumbnailUrl, isLoading, error };
}
