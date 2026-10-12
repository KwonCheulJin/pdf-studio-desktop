import { useCallback } from "react";
import { toast } from "sonner";
import { useErrorSnapshot } from "@kwoncheulJin/error-snapshot";
import type { MergeSource } from "@/renderer/shared/api/bindings";
import {
  MERGE_STATUS,
  MERGE_VIEW,
  useMergeStore,
  createPdfDocument
} from "@/renderer/entities/merge-plan";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  MERGE_OUTPUT_KIND,
  toPlatformError
} from "@/renderer/shared/platform";
import { getErrorSnapshot } from "@/renderer/shared/lib/error-snapshot";
import { buildMergeSources } from "../lib/build-merge-request";
import { discardMergedFile } from "../lib/discard-merged-file";
import { MERGE_ERROR_CODE } from "../config/merge-error-code";
import { useMergeRunStore } from "./merge-run-store";

interface UseMergeExecutionResult {
  /** 작업 공간 전체를 병합한다. */
  startMerge: () => Promise<void>;
  /** 실패한 병합과 같은 소스로 다시 병합한다. */
  retryMerge: () => Promise<void>;
}

/** 전체 병합 실행. 진행률·실패는 merge-run-store, 화면 상태는 merge-store에 둔다. */
export function useMergeExecution(): UseMergeExecutionResult {
  const { captureError } = useErrorSnapshot(getErrorSnapshot());
  const files = useMergeStore((state) => state.files);
  const mergeOrder = useMergeStore((state) => state.mergeOrder);
  const setStatus = useMergeStore((state) => state.setStatus);
  const setView = useMergeStore((state) => state.setView);
  const setMergedDocument = useMergeStore((state) => state.setMergedDocument);

  const runMerge = useCallback(
    async (sources: MergeSource[]) => {
      const jobId = crypto.randomUUID();
      const { startRun, updateProgress, endRun, failRun } =
        useMergeRunStore.getState();
      startRun({ jobId, sources });
      setStatus(MERGE_STATUS.MERGING);
      setView(MERGE_VIEW.WORKSPACE);
      setMergedDocument(null);

      const platform = getPlatform();
      try {
        const result = await platform.mergePdfs({
          request: {
            jobId,
            sources,
            output: { kind: MERGE_OUTPUT_KIND.TEMP }
          },
          onProgress: (progress) => updateProgress({ jobId, progress })
        });
        if (useMergeRunStore.getState().isCancelRequested) {
          // 취소를 누른 뒤에 끝난 결과는 보이지 않고 지운다.
          await discardMergedFile(result.outputPath);
          endRun();
          setStatus(MERGE_STATUS.IDLE);
          return;
        }
        setMergedDocument(
          createPdfDocument({
            path: result.outputPath,
            name: result.fileName,
            pageCount: result.pageCount,
            // 병합은 요청한 회전을 출력 페이지의 `/Rotate`로 그대로 쓴다.
            pageRotations: sources.flatMap((source) =>
              source.pages.map((page) => page.rotation)
            )
          })
        );
        endRun();
        setStatus(MERGE_STATUS.COMPLETE);
        setView(MERGE_VIEW.PREVIEW);
      } catch (error) {
        const platformError = toPlatformError(error);
        const { progress, isCancelRequested } = useMergeRunStore.getState();
        if (
          platformError.code === MERGE_ERROR_CODE.CANCELLED ||
          isCancelRequested
        ) {
          // 취소는 오류가 아니다. 조용히 작업 공간으로 돌아간다.
          endRun();
          setStatus(MERGE_STATUS.IDLE);
          return;
        }
        platform.log({
          level: LOG_LEVEL.ERROR,
          message: `병합 실패: [${platformError.code}] ${platformError.message}`
        });
        failRun({
          code: platformError.code,
          stage: progress?.stage ?? null,
          sourcePath: platformError.path
        });
        setStatus(MERGE_STATUS.ERROR);
        captureError(platformError, {
          source: "merge",
          code: platformError.code,
          sourceCount: sources.length
        });
      }
    },
    [captureError, setMergedDocument, setStatus, setView]
  );

  const startMerge = useCallback(async () => {
    if (files.length === 0) return;
    const sources = buildMergeSources({ files, mergeOrder });
    if (sources.length === 0) {
      toast.error(getErrorMessage(MERGE_ERROR_CODE.EMPTY_REQUEST));
      return;
    }
    await runMerge(sources);
  }, [files, mergeOrder, runMerge]);

  const retryMerge = useCallback(async () => {
    const { sources } = useMergeRunStore.getState();
    if (sources.length === 0) return;
    await runMerge(sources);
  }, [runMerge]);

  return { startMerge, retryMerge };
}
