import { useCallback } from "react";
import { useErrorSnapshot } from "@kwoncheulJin/error-snapshot";
import {
  MERGE_STATUS,
  MERGE_VIEW,
  useMergeStore,
  createPdfDocument
} from "@/renderer/entities/merge-plan";
import { getPlatform, MERGE_OUTPUT_KIND } from "@/renderer/shared/platform";
import { getErrorSnapshot } from "@/renderer/shared/lib/error-snapshot";
import { buildMergeSources } from "../lib/build-merge-request";

export function useMergeExecution() {
  const { captureError } = useErrorSnapshot(getErrorSnapshot());
  const files = useMergeStore((state) => state.files);
  const mergeOrder = useMergeStore((state) => state.mergeOrder);
  const setStatus = useMergeStore((state) => state.setStatus);
  const setProgress = useMergeStore((state) => state.setProgress);
  const setError = useMergeStore((state) => state.setError);
  const setView = useMergeStore((state) => state.setView);
  const setMergedDocument = useMergeStore((state) => state.setMergedDocument);

  const startMerge = useCallback(async () => {
    if (files.length === 0) return;

    const sources = buildMergeSources({ files, mergeOrder });
    if (sources.length === 0) {
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
      const result = await getPlatform().mergePdfs({
        request: {
          jobId: crypto.randomUUID(),
          sources,
          output: { kind: MERGE_OUTPUT_KIND.TEMP }
        },
        onProgress: (progress) => setProgress(progress.overallPercent)
      });
      const mergedDocument = createPdfDocument(
        result.outputPath,
        result.pageCount
      );
      setMergedDocument(mergedDocument);
      setProgress(100);
      setStatus(MERGE_STATUS.COMPLETE);
      setView(MERGE_VIEW.PREVIEW);
    } catch (error) {
      setError("병합 요청에 실패했습니다.");
      setStatus(MERGE_STATUS.ERROR);
      setProgress(0);
      // Error Snapshot 캡처 (병합 실패 정보 포함)
      const err = error instanceof Error ? error : new Error(String(error));
      captureError(err, {
        source: "merge",
        fileCount: files.length,
        mergeOrderCount: mergeOrder.length
      });
    }
  }, [
    captureError,
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
