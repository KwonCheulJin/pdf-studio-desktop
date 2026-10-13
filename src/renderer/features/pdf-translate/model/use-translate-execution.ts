import { useCallback } from "react";
import { toast } from "sonner";
import {
  baseSourceLanguageOf,
  SOURCE_LANGUAGE
} from "@/renderer/entities/translation";
import type {
  ErrorCode,
  TranslateOptions,
  TranslateRequest,
  TranslationPlan
} from "@/renderer/shared/api/bindings";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError
} from "@/renderer/shared/platform";
import { TRANSLATE_PROGRESS_TEXT } from "../config/translate-progress";
import { markTransferConfirmedOnce } from "./transfer-consent-store";
import {
  useTranslateSessionStore,
  type TranslateRunInfo
} from "./translate-session-store";

/** 작업 취소를 Rust가 알리는 코드 */
const CANCELLED_CODE = "CANCELLED" satisfies ErrorCode;

interface StartTranslationParams {
  options: TranslateOptions;
  /** 실행 전 확인의 계획(지금 옵션으로 받은 것). 진행 카드의 원문 언어·예상 합계에 쓴다. */
  plan: TranslationPlan;
  /** 동의 체크를 받고 시작하는가(받았으면 `transferConfirmedOnce`를 기록한다) */
  isConsentGiven: boolean;
}

interface RunInfoParams {
  fileName: string;
  options: TranslateOptions;
  plan: TranslationPlan;
}

/** 진행 카드 머리·사용량 상자 값. 자동 감지면 계획이 감지한 언어를 원문 언어로 보인다. */
function runInfoOf({
  fileName,
  options,
  plan
}: RunInfoParams): TranslateRunInfo {
  return {
    fileName,
    sourceLanguage:
      options.sourceLanguage === SOURCE_LANGUAGE.AUTO
        ? baseSourceLanguageOf(plan.detectedLanguage)
        : options.sourceLanguage,
    estimatedTokens: plan.estimatedInputTokens + plan.estimatedOutputTokens
  };
}

interface RunTranslationParams {
  request: TranslateRequest;
  info: TranslateRunInfo;
}

/**
 * 세션을 실행 상태로 바꾸고 `translatePdf`를 부른다. 진행률은 세션에 두고, 끝나면 결과 화면,
 * 실패하면 그 자리에 실패, 취소하면 옵션 화면이다. 다른 모드로 가도 작업은 계속된다.
 */
async function runTranslation({
  request,
  info
}: RunTranslationParams): Promise<void> {
  const session = useTranslateSessionStore.getState();
  // 문단 다시 번역이 도는 동안에는 시작하지 않는다(Rust도 `JOB_ALREADY_RUNNING`, 옵션 화면이 먼저 막는다).
  if (session.run !== null || session.retranslation !== null) return;
  session.startRun({ request, info, startedAt: Date.now() });
  try {
    const result = await getPlatform().translatePdf({
      request,
      onProgress: (progress) =>
        useTranslateSessionStore
          .getState()
          .updateProgress({ jobId: request.jobId, progress })
    });
    const { run, completeRun, cancelRun } = useTranslateSessionStore.getState();
    // 취소를 누른 뒤에 끝난 결과는 보이지 않는다(기록에는 남아 옵션 화면이 "이미 번역한 문서예요"를 보인다).
    if (run?.isCancelRequested === true) {
      cancelRun();
      return;
    }
    completeRun(result);
  } catch (error) {
    const platformError = toPlatformError(error);
    const { run, failRun, cancelRun } = useTranslateSessionStore.getState();
    // 취소는 오류가 아니다. 조용히 옵션 화면으로 돌아간다.
    if (
      platformError.code === CANCELLED_CODE ||
      run?.isCancelRequested === true
    ) {
      cancelRun();
      return;
    }
    getPlatform().log({
      level: LOG_LEVEL.ERROR,
      message: `번역 실패: [${platformError.code}] ${platformError.message}`
    });
    failRun(platformError.code);
  }
}

/**
 * 번역 실행(계획서 P6-9 "번역 시작", P6-10 진행·취소·실패). 기록이 있으면 늘 이어서 한다
 * (처음부터 다시 하는 버튼은 없다).
 */
export function useTranslateExecution() {
  const startTranslation = useCallback(
    async ({ options, plan, isConsentGiven }: StartTranslationParams) => {
      const { file, run } = useTranslateSessionStore.getState();
      if (file === null || run !== null) return;
      if (isConsentGiven) markTransferConfirmedOnce();
      await runTranslation({
        request: {
          jobId: crypto.randomUUID(),
          path: file.path,
          options,
          resume: true
        },
        info: runInfoOf({ fileName: file.name, options, plan })
      });
    },
    []
  );

  /**
   * 실패한 요청을 새 작업 ID로 다시 보낸다(이어하기라 끝난 묶음은 다시 보내지 않는다).
   * 같은 문서·옵션을 이미 동의하고 보낸 전송의 계속이라 동의를 다시 받지 않는다.
   */
  const retryTranslation = useCallback(async () => {
    const { failure } = useTranslateSessionStore.getState();
    if (failure === null) return;
    await runTranslation({
      request: { ...failure.request, jobId: crypto.randomUUID() },
      info: failure.info
    });
  }, []);

  /** 진행 중인 번역을 취소한다. 결과(`CANCELLED`)는 실행 쪽이 조용히 처리한다. */
  const cancelTranslation = useCallback(async () => {
    const { run, requestCancel } = useTranslateSessionStore.getState();
    if (run === null || run.isCancelRequested) return;
    requestCancel();
    try {
      await getPlatform().cancelJob(run.jobId);
    } catch (error) {
      const platformError = toPlatformError(error);
      getPlatform().log({
        level: LOG_LEVEL.ERROR,
        message: `번역 취소 실패 ${run.jobId}: [${platformError.code}] ${platformError.message}`
      });
      toast.error(TRANSLATE_PROGRESS_TEXT.CANCEL_FAILED_TITLE, {
        description: getErrorMessage(platformError.code)
      });
    }
  }, []);

  return { startTranslation, retryTranslation, cancelTranslation };
}
