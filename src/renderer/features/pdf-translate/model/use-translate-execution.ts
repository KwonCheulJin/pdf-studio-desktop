import { useCallback } from "react";
import { toast } from "sonner";
import type {
  ErrorCode,
  TranslateOptions,
  TranslateRequest
} from "@/renderer/shared/api/bindings";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError
} from "@/renderer/shared/platform";
import { TRANSLATE_OPTIONS_TEXT } from "../config/translate-options";
import { markTransferConfirmedOnce } from "./transfer-consent-store";
import { useTranslateSessionStore } from "./translate-session-store";

/** 작업 취소를 Rust가 알리는 코드 */
const CANCELLED_CODE = "CANCELLED" satisfies ErrorCode;

interface StartTranslationParams {
  options: TranslateOptions;
  /** 동의 체크를 받고 시작하는가(받았으면 `transferConfirmedOnce`를 기록한다) */
  isConsentGiven: boolean;
}

/**
 * 번역 실행(계획서 P6-9 "번역 시작"). 세션을 실행 상태로 바꾸고 `translatePdf`를 부른다.
 * 기록이 있으면 늘 이어서 한다(처음부터 다시 하는 버튼은 없다). 진행 화면·취소·실패 화면은 Step 45다.
 */
export function useTranslateExecution() {
  const startTranslation = useCallback(
    async ({ options, isConsentGiven }: StartTranslationParams) => {
      const session = useTranslateSessionStore.getState();
      const { file } = session;
      if (file === null || session.run !== null) return;
      if (isConsentGiven) markTransferConfirmedOnce();
      const request: TranslateRequest = {
        jobId: crypto.randomUUID(),
        path: file.path,
        options,
        resume: true
      };
      session.startRun({ jobId: request.jobId, request });
      try {
        const result = await getPlatform().translatePdf({ request });
        useTranslateSessionStore.getState().endRun(result);
      } catch (error) {
        useTranslateSessionStore.getState().endRun(null);
        const platformError = toPlatformError(error);
        if (platformError.code === CANCELLED_CODE) return;
        getPlatform().log({
          level: LOG_LEVEL.ERROR,
          message: `번역 실패: [${platformError.code}] ${platformError.message}`
        });
        toast.error(TRANSLATE_OPTIONS_TEXT.RUN_FAILED_TITLE, {
          description: getErrorMessage(platformError.code)
        });
      }
    },
    []
  );

  return { startTranslation };
}
