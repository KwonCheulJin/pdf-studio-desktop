import { getPlatform } from "@/renderer/shared/platform";
import { PdfDocumentCache } from "./pdf-document-cache";
import { renderPageToBitmap } from "./render-page";
import { RenderedPageCache } from "./rendered-page-cache";

/** 쓰지 않는 렌더 결과(PNG)를 남겨 두는 상한. 썸네일 수백 장 또는 미리보기 수십 장 */
const MAX_RENDERED_PAGE_CACHE_BYTES = 64 * 1024 * 1024;

const renderedPageCache = new RenderedPageCache({
  maxBytes: MAX_RENDERED_PAGE_CACHE_BYTES
});

const documentCache = new PdfDocumentCache({
  readBytes: (path) => getPlatform().readPdf(path),
  onClose: (path) => renderedPageCache.removePath(path)
});

export interface RenderedPageRequest {
  path: string;
  /** 0부터 센 원본 페이지 번호 */
  pageIndex: number;
  scale: number;
  /** 절대 회전 각도. 생략하면 PDF의 `/Rotate`를 따른다. */
  rotation?: number;
}

export interface RenderedPageLease {
  urlPromise: Promise<string>;
  /** 여러 번 불러도 한 번만 놓는다. */
  release: () => void;
}

export interface PdfCacheStats {
  /** destroy되지 않은 문서의 경로(개발 서버에서만 채워진다) */
  liveDocumentPaths: string[];
  /** 렌더 캐시 항목마다 그 경로 하나 */
  renderedPagePaths: string[];
}

export function getRenderedPageKey({
  path,
  pageIndex,
  scale,
  rotation
}: RenderedPageRequest): string {
  return JSON.stringify([path, pageIndex, scale, rotation ?? null]);
}

/** 문서 참조 하나를 잡는다(읽지는 않는다). 돌려준 함수로 놓는다. */
export function retainPdfDocument(path: string): () => void {
  documentCache.retain(path);
  return () => documentCache.release(path);
}

/** 문서와 렌더 결과를 함께 잡는다. 캐시에 있으면 다시 그리지 않는다. */
export function acquireRenderedPage(
  request: RenderedPageRequest
): RenderedPageLease {
  const { path, pageIndex, scale, rotation } = request;
  const key = getRenderedPageKey(request);
  const documentPromise = documentCache.acquire(path);
  const urlPromise = renderedPageCache.acquire({
    key,
    path,
    render: async () =>
      renderPageToBitmap({
        document: await documentPromise,
        pageIndex,
        scale,
        rotation
      })
  });
  let isReleased = false;
  return {
    urlPromise,
    release: () => {
      if (isReleased) {
        return;
      }
      isReleased = true;
      renderedPageCache.release(key);
      documentCache.release(path);
    }
  };
}

/** E2E 확인용. 개발 서버의 E2E 플랫폼만 부른다. */
export function getPdfCacheStats(): PdfCacheStats {
  return {
    liveDocumentPaths: documentCache.getLiveDocumentPaths(),
    renderedPagePaths: renderedPageCache.getEntryPaths()
  };
}
