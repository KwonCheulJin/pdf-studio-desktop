import { useCallback, useEffect } from "react";
import { ipcClient } from "../lib/ipc-client";
import { buildMergeRequest } from "../lib/build-merge-request";
import { MERGE_STATUS, MERGE_VIEW } from "../model/merge-state";
import { useMergeStore } from "../model/merge-store";
import { createPdfDocument } from "../model/pdf-document";
import type {
  MergeResult,
  MergeProgress
} from "../../../main/types/ipc-schema";

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
      // 전체 병합 중일 때만 처리 (선택 병합 이벤트는 무시)
      if (useMergeStore.getState().status !== MERGE_STATUS.MERGING) return;
      setProgress(progress.percentage);
      setStatus(MERGE_STATUS.MERGING);
    };

    const handleComplete = (result: MergeResult) => {
      // 전체 병합 중일 때만 처리 (선택 병합 이벤트는 무시)
      if (useMergeStore.getState().status !== MERGE_STATUS.MERGING) return;
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
