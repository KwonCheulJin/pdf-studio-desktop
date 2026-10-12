import { FILE_EXTENSIONS } from "@/renderer/shared/constants/app";
import { useRenderedPage } from "@/renderer/shared/lib/pdfjs";
import { useInViewport } from "@/renderer/shared/lib/use-in-viewport";
import { THUMBNAIL_RENDER } from "../config/thumbnail";

interface UsePageThumbnailParams {
  filePath: string;
  /** 0부터 센 원본 페이지 번호 */
  pageIndex: number;
}

interface UsePageThumbnailResult {
  /** 썸네일 영역에 붙인다. 이 요소가 화면 근처에 있을 때만 그린다. */
  ref: (element: HTMLDivElement | null) => (() => void) | undefined;
  thumbnailUrl: string | null;
  isLoading: boolean;
}

/** 카드 썸네일. 렌더 결과는 공용 캐시가 갖고, 화면에 보이는 카드만 그린다. */
export function usePageThumbnail({
  filePath,
  pageIndex
}: UsePageThumbnailParams): UsePageThumbnailResult {
  const { ref, isInViewport } = useInViewport<HTMLDivElement>({
    rootMargin: THUMBNAIL_RENDER.VIEWPORT_MARGIN
  });
  const isPdf = filePath.toLowerCase().endsWith(FILE_EXTENSIONS.PDF);
  const { url, isLoading } = useRenderedPage({
    path: filePath,
    pageIndex,
    scale: THUMBNAIL_RENDER.SCALE,
    rotation: THUMBNAIL_RENDER.ROTATION,
    isEnabled: isPdf && isInViewport
  });
  return { ref, thumbnailUrl: url, isLoading };
}
