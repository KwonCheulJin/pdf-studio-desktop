import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { PREVIEW_CONFIG } from "@/renderer/shared/constants/preview";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

interface PageDimensions {
  width: number;
  height: number;
}

interface PageData {
  dataUrl: string | null;
  dimensions: PageDimensions | null;
  isLoading: boolean;
}

interface UsePreviewPagesResult {
  /** 총 페이지 수 */
  totalPages: number;
  /** 페이지 데이터 가져오기 */
  getPageData: (pageIndex: number) => PageData;
  /** 특정 페이지 로드 요청 */
  loadPage: (pageIndex: number) => void;
  /** PDF 로드 중 여부 */
  isDocumentLoading: boolean;
  /** PDF 로드 에러 */
  error: string | null;
}

interface UsePreviewPagesOptions {
  pdfDocument: PdfDocument | null;
  isOpen: boolean;
}

/**
 * PDF 미리보기 페이지 로드를 관리하는 훅
 * - PDF 문서 로드 및 캐싱
 * - 페이지별 on-demand 렌더링
 * - Virtuoso와 연동하여 보이는 페이지만 렌더링
 */
export function usePreviewPages({
  pdfDocument,
  isOpen
}: UsePreviewPagesOptions): UsePreviewPagesResult {
  const [totalPages, setTotalPages] = useState(0);
  const [isDocumentLoading, setIsDocumentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageDataMap, setPageDataMap] = useState<Map<number, PageData>>(
    new Map()
  );

  // PDF 문서 객체 참조
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  // 렌더링 취소용
  const abortControllerRef = useRef<AbortController | null>(null);
  // 현재 로드 중인 페이지 추적
  const loadingPagesRef = useRef<Set<number>>(new Set());

  // PDF 문서 로드
  useEffect(() => {
    if (!isOpen || !pdfDocument) {
      return;
    }

    const loadDocument = async () => {
      setIsDocumentLoading(true);
      setError(null);
      setPageDataMap(new Map());

      // 이전 AbortController 정리
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      try {
        // 이전 문서 정리
        if (pdfDocRef.current) {
          await pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }

        const { data } = await ipcClient.file.readPdf(pdfDocument.path);
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;

        pdfDocRef.current = pdf;
        setTotalPages(pdf.numPages);
      } catch {
        setError("PDF를 불러올 수 없습니다.");
      } finally {
        setIsDocumentLoading(false);
      }
    };

    loadDocument();

    return () => {
      abortControllerRef.current?.abort();
      loadingPagesRef.current.clear();
    };
  }, [isOpen, pdfDocument]);

  // 모달 닫힐 때 리소스 정리
  useEffect(() => {
    if (!isOpen && pdfDocRef.current) {
      pdfDocRef.current.destroy();
      pdfDocRef.current = null;
      setPageDataMap(new Map());
      setTotalPages(0);
      loadingPagesRef.current.clear();
    }
  }, [isOpen]);

  // 페이지 렌더링 함수
  const renderPage = useCallback(
    async (pageIndex: number): Promise<PageData | null> => {
      const pdf = pdfDocRef.current;
      if (!pdf) return null;

      let page: PDFPageProxy | null = null;

      try {
        page = await pdf.getPage(pageIndex + 1); // 1-based
        const viewport = page.getViewport({ scale: PREVIEW_CONFIG.SCALE });

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Canvas context 생성 실패");
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport,
          canvas
        }).promise;

        const dataUrl = canvas.toDataURL("image/png");

        return {
          dataUrl,
          dimensions: { width: viewport.width, height: viewport.height },
          isLoading: false
        };
      } catch {
        return null;
      } finally {
        page?.cleanup();
      }
    },
    []
  );

  // 페이지 로드 요청
  const loadPage = useCallback(
    (pageIndex: number) => {
      // 이미 로드되었거나 로드 중이면 스킵
      const existingData = pageDataMap.get(pageIndex);
      if (existingData?.dataUrl || loadingPagesRef.current.has(pageIndex)) {
        return;
      }

      // 로딩 상태 설정
      loadingPagesRef.current.add(pageIndex);
      setPageDataMap((prev) => {
        const next = new Map(prev);
        next.set(pageIndex, {
          dataUrl: null,
          dimensions: null,
          isLoading: true
        });
        return next;
      });

      // 비동기 렌더링
      renderPage(pageIndex).then((result) => {
        loadingPagesRef.current.delete(pageIndex);

        if (result) {
          setPageDataMap((prev) => {
            const next = new Map(prev);
            next.set(pageIndex, result);
            return next;
          });
        }
      });
    },
    [pageDataMap, renderPage]
  );

  // 페이지 데이터 가져오기
  const getPageData = useCallback(
    (pageIndex: number): PageData => {
      return (
        pageDataMap.get(pageIndex) ?? {
          dataUrl: null,
          dimensions: null,
          isLoading: false
        }
      );
    },
    [pageDataMap]
  );

  return {
    totalPages,
    getPageData,
    loadPage,
    isDocumentLoading,
    error
  };
}
