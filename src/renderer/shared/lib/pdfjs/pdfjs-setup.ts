import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { PDFJS_ASSET_DIRECTORY } from "./asset-paths";

// pdf.js를 쓰는 곳은 이 모듈 하나다. Worker 설정도 여기서 한 번만 한다.
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/**
 * 자산은 절대 URL로 넘긴다. 상대 경로면 Worker 안에서 fetch할 때
 * Worker 스크립트 위치(`assets/`) 기준으로 풀려 잘못된 곳을 읽는다.
 */
function assetUrl(directory: string): string {
  return new URL(`${import.meta.env.BASE_URL}${directory}`, document.baseURI)
    .href;
}

const DOCUMENT_ASSET_OPTIONS = {
  cMapUrl: assetUrl(PDFJS_ASSET_DIRECTORY.CMAPS),
  cMapPacked: true,
  standardFontDataUrl: assetUrl(PDFJS_ASSET_DIRECTORY.STANDARD_FONTS),
  wasmUrl: assetUrl(PDFJS_ASSET_DIRECTORY.WASM),
  iccUrl: assetUrl(PDFJS_ASSET_DIRECTORY.ICCS)
} as const;

export function openPdfDocument(data: Uint8Array): PDFDocumentLoadingTask {
  return getDocument({ ...DOCUMENT_ASSET_OPTIONS, data });
}
