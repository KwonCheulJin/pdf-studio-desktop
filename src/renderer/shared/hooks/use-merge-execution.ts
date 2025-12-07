import { useCallback, useEffect } from "react";
import { ipcClient } from "../lib/ipc-client";
import { MERGE_STATUS, MERGE_VIEW } from "../model/merge-state";
import { useMergeStore } from "../model/merge-store";
import { createPdfDocument } from "../model/pdf-document";
import type { MergeOrderItem, PdfDocument } from "../model/pdf-document";
import type {
  MergeRequest,
  MergeResult,
  MergeProgress
} from "../../../main/types/ipc-schema";

interface BuildMergeRequestParams {
  files: PdfDocument[];
  mergeOrder: MergeOrderItem[];
}

function buildMergeRequest({
  files,
  mergeOrder
}: BuildMergeRequestParams): MergeRequest {
  // mergeOrder가 비어 있으면 파일 순서대로 모든 활성 페이지를 병합
  if (mergeOrder.length === 0) {
    return {
      files: files.map((file) => ({
        path: file.path,
        pages: file.pages
          .filter((page) => !page.isDeleted)
          .map((page) => page.sourcePageIndex)
      }))
    };
  }

  // mergeOrder 순서를 유지하면서 연속된 동일 파일을 하나의 청크로 묶어 요청 생성
  const segments: MergeRequest["files"] = [];
  let currentSegment: { path: string; pages: number[] } | null = null;

  mergeOrder.forEach((item) => {
    const file = files.find((candidate) => candidate.id === item.fileId);
    if (!file) return;

    const page = file.pages.find((candidate) => candidate.id === item.pageId);
    if (!page || page.isDeleted) return;

    if (currentSegment && currentSegment.path === file.path) {
      currentSegment.pages.push(page.sourcePageIndex);
      return;
    }

    currentSegment = {
      path: file.path,
      pages: [page.sourcePageIndex]
    };
    segments.push(currentSegment);
  });

  if (segments.length === 0) {
    return { files: [] };
  }

  return { files: segments };
}

export function useMergeExecution() {
  const files = useMergeStore((state) => state.files);
  const mergeOrder = useMergeStore((state) => state.mergeOrder);
  const setStatus = useMergeStore((state) => state.setStatus);
  const setProgress = useMergeStore((state) => state.setProgress);
  const setError = useMergeStore((state) => state.setError);
  const setView = useMergeStore((state) => state.setView);
  const setMergedDocument = useMergeStore((state) => state.setMergedDocument);

  // IPC 이벤트 리스너 등록
  useEffect(() => {
    const handleProgress = (progress: MergeProgress) => {
      setProgress(progress.percentage);
      setStatus(MERGE_STATUS.MERGING);
    };

    const handleComplete = (result: MergeResult) => {
      const mergedDocument = createPdfDocument(
        result.outputPath,
        result.totalPages
      );
      setMergedDocument(mergedDocument);
      setProgress(100);
      setStatus(MERGE_STATUS.COMPLETE);
      setView(MERGE_VIEW.PREVIEW);
    };

    ipcClient.merge.onProgress(handleProgress);
    ipcClient.merge.onComplete(handleComplete);

    return () => {
      ipcClient.merge.removeListeners();
    };
  }, [setMergedDocument, setProgress, setStatus, setView]);

  const startMerge = useCallback(async () => {
    if (files.length === 0) return;

    const request = buildMergeRequest({ files, mergeOrder });
    if (request.files.length === 0) {
      setError("병합할 페이지가 없습니다.");
      setStatus(MERGE_STATUS.ERROR);
      setProgress(0);
      return;
    }

    setError(null);
    setStatus(MERGE_STATUS.MERGING);
    setProgress(0);
    setView(MERGE_VIEW.WORKSPACE);
    setMergedDocument(null);

    try {
      await ipcClient.merge.start(request);
    } catch {
      setError("병합 요청에 실패했습니다.");
      setStatus(MERGE_STATUS.ERROR);
      setProgress(0);
    }
  }, [
    files,
    mergeOrder,
    setError,
    setMergedDocument,
    setProgress,
    setStatus,
    setView
  ]);

  return { startMerge };
}
