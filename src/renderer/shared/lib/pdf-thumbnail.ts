import * as pdfjsLib from "pdfjs-dist";
import { ipcClient } from "./ipc-client";

// PDF.js Worker 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const THUMBNAIL_DEFAULTS = {
  PAGE_NUMBER: 1,
  SCALE: 0.5,
  PREVIEW_SCALE: 1.5
} as const;

interface ThumbnailOptions {
  filePath: string;
  pageNumber?: number;
  scale?: number;
}

interface ThumbnailResult {
  dataUrl: string;
  width: number;
  height: number;
}

export async function generateThumbnail(
  options: ThumbnailOptions
): Promise<ThumbnailResult> {
  const {
    filePath,
    pageNumber = THUMBNAIL_DEFAULTS.PAGE_NUMBER,
    scale = THUMBNAIL_DEFAULTS.SCALE
  } = options;

  // IPC를 통해 Main 프로세스에서 파일 데이터 가져오기
  const { data } = await ipcClient.file.readPdf(filePath);

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  // Canvas 생성
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context를 생성할 수 없습니다.");
  }

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // 렌더링
  await page.render({
    canvasContext: context,
    viewport,
    canvas
  }).promise;

  const dataUrl = canvas.toDataURL("image/png");

  // 리소스 정리
  page.cleanup();
  await pdf.destroy();

  return {
    dataUrl,
    width: viewport.width,
    height: viewport.height
  };
}

export async function generatePreview(
  filePath: string
): Promise<ThumbnailResult> {
  return generateThumbnail({
    filePath,
    scale: THUMBNAIL_DEFAULTS.PREVIEW_SCALE
  });
}

// 모든 페이지 썸네일 생성 (펼침 상태용)
interface AllPageThumbnailsOptions {
  filePath: string;
  pageCount: number;
  scale?: number;
  onPageGenerated?: (pageIndex: number, dataUrl: string) => void;
}

export async function generateAllPageThumbnails(
  options: AllPageThumbnailsOptions
): Promise<Map<number, string>> {
  const {
    filePath,
    pageCount,
    scale = THUMBNAIL_DEFAULTS.SCALE,
    onPageGenerated
  } = options;

  // IPC를 통해 Main 프로세스에서 파일 데이터 가져오기
  const { data } = await ipcClient.file.readPdf(filePath);

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const thumbnails = new Map<number, string>();

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      page.cleanup();
      continue;
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport,
      canvas
    }).promise;

    const dataUrl = canvas.toDataURL("image/png");
    const pageIndex = pageNum - 1; // 0-based index

    thumbnails.set(pageIndex, dataUrl);
    onPageGenerated?.(pageIndex, dataUrl);

    page.cleanup();
  }

  await pdf.destroy();

  return thumbnails;
}

// 특정 페이지 썸네일 생성 (개별 요청용)
export async function generatePageThumbnail(
  filePath: string,
  pageIndex: number,
  scale: number = THUMBNAIL_DEFAULTS.SCALE
): Promise<string> {
  const result = await generateThumbnail({
    filePath,
    pageNumber: pageIndex + 1, // 1-based page number
    scale
  });
  return result.dataUrl;
}
