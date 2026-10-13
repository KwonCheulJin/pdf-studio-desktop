import type { PageViewport } from "pdfjs-dist";

/** PDF 사용자 공간 상자. `x`·`y`는 왼쪽 아래 모서리, 원점은 사용자 공간 원점 그대로다. */
export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** viewport 좌표 상자. 원점은 쪽 화면의 왼쪽 위, y는 아래로 커진다. */
export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 쪽 하나의 화면 변환. pdf.js `page.getViewport({ scale: 1 })`(문서 `/Rotate`, `page.view`의 원점,
 * `UserUnit` 반영)로 만든다. 배율 1의 값이라 확대와 상관없이 같고, 쓰는 쪽은 `width`·`height`에
 * 대한 비율로 화면 크기에 맞춘다. 상자를 손으로 쓴 공식으로 바꾸지 않는다(ADR 0001 §2).
 */
export interface PageGeometry {
  width: number;
  height: number;
  toViewportRect: (rect: PdfRect) => ViewportRect;
}

export function toPageGeometry(viewport: PageViewport): PageGeometry {
  return {
    width: viewport.width,
    height: viewport.height,
    toViewportRect: ({ x, y, w, h }) => {
      const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
        x,
        y,
        x + w,
        y + h
      ]);
      return {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1)
      };
    }
  };
}
