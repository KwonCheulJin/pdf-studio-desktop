import { useCallback } from "react";
import { toast } from "sonner";
import type { CompareRequest, ErrorCode } from "@/renderer/shared/api/bindings";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import { reportError } from "@/renderer/shared/lib/error-report";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError,
  type PlatformError
} from "@/renderer/shared/platform";
import { COMPARE_SLOT, COMPARE_SLOTS } from "../config/compare-files";
import {
  COMPARE_PROGRESS_TEXT,
  compareRunFailureTitle
} from "../config/compare-stage";
import { compareReadinessOf } from "../lib/compare-readiness";
import { notifyCompareFailure } from "../lib/notify-compare-failure";
import { useCompareRunStore, type CompareRunNames } from "./compare-run-store";
import { useCompareSessionStore } from "./compare-session-store";

/** 작업 취소를 Rust가 알리는 코드 */
const CANCELLED_CODE = "CANCELLED" satisfies ErrorCode;

interface UseCompareExecutionResult {
  /** 세션의 두 문서·옵션으로 비교한다. 실행할 수 없으면 아무 일도 하지 않는다. */
  startCompare: () => Promise<void>;
  /** 진행 중인 비교를 취소한다. 결과(`CANCELLED`)는 실행 쪽이 조용히 처리한다. */
  cancelCompare: () => Promise<void>;
}

interface NotifyRunFailureParams {
  error: PlatformError;
  names: CompareRunNames;
  request: CompareRequest;
}

/** 실패한 파일을 알면(`AppError.path`) 그 이름으로 알린다. 문구는 오류 코드 표, 로그는 플랫폼 `message` */
function notifyRunFailure({ error, names, request }: NotifyRunFailureParams) {
  // 슬롯 이름(`before`·`after`)이 요청의 문서 필드 이름과 같다.
  const failedSlot = COMPARE_SLOTS.find(
    (slot) => error.path !== null && error.path === request[slot]
  );
  getPlatform().log({
    level: LOG_LEVEL.ERROR,
    message: `비교 실패: [${error.code}] ${error.message}`
  });
  toast.error(
    failedSlot
      ? compareRunFailureTitle(names[failedSlot])
      : COMPARE_PROGRESS_TEXT.FAILED_TITLE,
    { description: getErrorMessage(error.code) }
  );
  void reportError({
    error,
    meta: { source: "compare", code: error.code }
  });
}

/**
 * 비교 실행(계획서 P3-3a). 진행률·취소는 compare-run-store, 결과는 세션 스토어에 둔다.
 * 끝나면 결과 화면, 취소·실패하면 옵션 화면으로 돌아간다. 다른 모드로 가도 작업은 계속된다.
 */
export function useCompareExecution(): UseCompareExecutionResult {
  const startCompare = useCallback(async () => {
    const session = useCompareSessionStore.getState();
    const before = session[COMPARE_SLOT.BEFORE];
    const after = session[COMPARE_SLOT.AFTER];
    const { blockReason } = compareReadinessOf({
      files: { [COMPARE_SLOT.BEFORE]: before, [COMPARE_SLOT.AFTER]: after },
      options: session.options,
      isTextCompared: session.isTextCompared
    });
    if (!before || !after || blockReason !== null) return;

    const run = useCompareRunStore.getState();
    if (run.jobId !== null) return;
    const request: CompareRequest = {
      jobId: crypto.randomUUID(),
      before: before.path,
      after: after.path,
      options: session.options
    };
    const names: CompareRunNames = {
      [COMPARE_SLOT.BEFORE]: before.name,
      [COMPARE_SLOT.AFTER]: after.name
    };
    const startedAt = Date.now();
    run.startRun({ request, names, startedAt });

    try {
      const result = await getPlatform().comparePdfs({
        request,
        onProgress: (progress) =>
          useCompareRunStore
            .getState()
            .updateProgress({ jobId: request.jobId, progress })
      });
      const { isCancelRequested, endRun } = useCompareRunStore.getState();
      endRun();
      // 취소를 누른 뒤에 끝난 결과는 보이지 않는다.
      if (!isCancelRequested) {
        // 실행 중에 슬롯이 바뀌어도 결과는 실행할 때의 두 문서·옵션을 기억한다.
        useCompareSessionStore.getState().showResult({
          jobId: request.jobId,
          result,
          files: { [COMPARE_SLOT.BEFORE]: before, [COMPARE_SLOT.AFTER]: after },
          options: request.options,
          elapsedMs: Date.now() - startedAt
        });
      }
    } catch (error) {
      const platformError = toPlatformError(error);
      const { isCancelRequested, endRun } = useCompareRunStore.getState();
      endRun();
      // 취소는 오류가 아니다. 조용히 옵션 화면으로 돌아간다.
      if (platformError.code === CANCELLED_CODE || isCancelRequested) return;
      notifyRunFailure({ error: platformError, names, request });
    }
  }, []);

  const cancelCompare = useCallback(async () => {
    const { jobId, isCancelRequested, requestCancel } =
      useCompareRunStore.getState();
    if (jobId === null || isCancelRequested) return;
    requestCancel();
    try {
      await getPlatform().cancelJob(jobId);
    } catch (error) {
      notifyCompareFailure({
        title: COMPARE_PROGRESS_TEXT.CANCEL_FAILED_TITLE,
        error: toPlatformError(error),
        context: `비교 취소 실패 ${jobId}`
      });
    }
  }, []);

  return { startCompare, cancelCompare };
}
