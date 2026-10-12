import type { PDFDocumentProxy } from "pdfjs-dist";

const RENDERED_IMAGE_TYPE = "image/png";
const CANVAS_ENCODE_ERROR = "렌더 결과를 이미지로 바꾸지 못했습니다.";

export interface RenderPageParams {
  document: PDFDocumentProxy;
  /** 0부터 센 원본 페이지 번호 */
  pageIndex: number;
  scale: number;
  /** 절대 회전 각도. 생략하면 PDF의 `/Rotate`를 따른다. */
  rotation?: number;
}

function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error(CANVAS_ENCODE_ERROR));
      }
    }, RENDERED_IMAGE_TYPE);
  });
}

/**
 * 페이지 하나를 그려 PNG Blob으로 돌려준다. 썸네일·미리보기가 모두 이 함수로 그린다.
 * 화면용 `blob:` URL은 렌더 캐시가 만들고 지운다.
 */
export async function renderPageToBitmap({
  document,
  pageIndex,
  scale,
  rotation
}: RenderPageParams): Promise<Blob> {
  const page = await document.getPage(pageIndex + 1);
  const canvas = window.document.createElement("canvas");
  try {
    const viewport = page.getViewport({ scale, rotation });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return await encodeCanvas(canvas);
  } finally {
    page.cleanup();
    // WebKit은 캔버스 메모리 총량에 상한이 있어 바로 돌려준다.
    canvas.width = 0;
    canvas.height = 0;
  }
}
