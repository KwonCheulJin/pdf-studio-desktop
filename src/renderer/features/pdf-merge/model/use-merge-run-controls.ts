import { useCallback } from "react";
import { MERGE_STATUS, useMergeStore } from "@/renderer/entities/merge-plan";
import { getPlatform, toPlatformError } from "@/renderer/shared/platform";
import { notifyFailure } from "../lib/notify-failure";
import { useMergeRunStore } from "./merge-run-store";

interface UseMergeRunControlsResult {
  /** 진행 중인 병합을 취소한다. 결과(`CANCELLED`)는 실행 쪽이 조용히 처리한다. */
  cancelMerge: () => Promise<void>;
  /** 실패 표시를 닫고 작업 공간으로 돌아간다. */
  closeFailure: () => void;
  /** 실패가 가리키는 소스 파일을 작업 공간에서 빼고 실패 표시를 닫는다. */
  removeFailedFile: () => void;
}

/** 진행 오버레이의 취소·닫기·이 파일 빼기 */
export function useMergeRunControls(): UseMergeRunControlsResult {
  const setStatus = useMergeStore((state) => state.setStatus);
  const removeFile = useMergeStore((state) => state.removeFile);

  const cancelMerge = useCallback(async () => {
    const { jobId, isCancelRequested, requestCancel } =
      useMergeRunStore.getState();
    if (jobId === null || isCancelRequested) return;
    requestCancel();
    try {
      await getPlatform().cancelJob(jobId);
    } catch (error) {
      notifyFailure({
        title: "병합을 취소하지 못했습니다.",
        error: toPlatformError(error),
        context: `병합 취소 실패 ${jobId}`
      });
    }
  }, []);

  const closeFailure = useCallback(() => {
    useMergeRunStore.getState().endRun();
    setStatus(MERGE_STATUS.IDLE);
  }, [setStatus]);

  const removeFailedFile = useCallback(() => {
    const sourcePath = useMergeRunStore.getState().failure?.sourcePath;
    if (sourcePath) {
      const failedFiles = useMergeStore
        .getState()
        .files.filter((file) => file.path === sourcePath);
      for (const file of failedFiles) {
        removeFile(file.id);
      }
    }
    closeFailure();
  }, [closeFailure, removeFile]);

  return { cancelMerge, closeFailure, removeFailedFile };
}
