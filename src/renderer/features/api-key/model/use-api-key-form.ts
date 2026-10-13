import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError,
  type PlatformError
} from "@/renderer/shared/platform";
import {
  API_KEY_CHECK_DELAY_MS,
  API_KEY_CHECK_STATUS,
  API_KEY_INVALID_CODE,
  API_KEY_TEXT,
  type ApiKeyCheckStatus
} from "../config/api-key";
import { isWellFormedApiKey } from "../lib/api-key-format";
import { useApiKeyStore } from "./api-key-store";

interface ApiKeyCheck {
  status: ApiKeyCheckStatus;
  /** 실패 문구(코드로 고른 것). 실패가 아니면 `null` */
  errorMessage: string | null;
}

const IDLE_CHECK: ApiKeyCheck = {
  status: API_KEY_CHECK_STATUS.IDLE,
  errorMessage: null
};
const CHECKING_CHECK: ApiKeyCheck = {
  status: API_KEY_CHECK_STATUS.CHECKING,
  errorMessage: null
};
const VERIFIED_CHECK: ApiKeyCheck = {
  status: API_KEY_CHECK_STATUS.VERIFIED,
  errorMessage: null
};

function failedCheck(errorMessage: string): ApiKeyCheck {
  return { status: API_KEY_CHECK_STATUS.FAILED, errorMessage };
}

interface LogFailureParams {
  action: string;
  error: PlatformError;
}

/** 실패를 코드·플랫폼 메시지로만 남긴다(키를 싣지 않는다, ADR 0002 §12). */
function logFailure({ action, error }: LogFailureParams): void {
  getPlatform().log({
    level: LOG_LEVEL.WARN,
    message: `${action} 실패: [${error.code}] ${error.message}`
  });
}

/**
 * 키 모달 입력(시안 11). 붙여 넣거나 입력을 멈추면 형식을 보고, 맞으면 `verifyApiKey`를 한 번 부른다.
 * 입력이 바뀌면 그 전 확인의 응답은 버린다(마지막 요청의 응답만 쓴다). 저장은 확인에 성공한 키만 하고,
 * 저장하면 입력을 비운다(키 원문을 화면 상태에 남기지 않는다).
 */
export function useApiKeyForm() {
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<ApiKeyCheck>(IDLE_CHECK);
  const [isSaving, setIsSaving] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const setStatus = useApiKeyStore((state) => state.setStatus);
  /** 확인 요청마다 늘린다. 응답이 왔을 때 값이 다르면 그 뒤에 입력이 바뀐 것이다. */
  const checkIdRef = useRef(0);
  const checkTimerRef = useRef<number | null>(null);
  const isPastingRef = useRef(false);

  const cancelPendingCheck = useCallback(() => {
    if (checkTimerRef.current !== null) {
      window.clearTimeout(checkTimerRef.current);
      checkTimerRef.current = null;
    }
    checkIdRef.current += 1;
  }, []);

  // 모달이 닫히면 기다리던 확인을 멈추고 늦게 온 응답을 버린다.
  useEffect(() => cancelPendingCheck, [cancelPendingCheck]);

  const runCheck = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") {
      setCheck(IDLE_CHECK);
      return;
    }
    if (!isWellFormedApiKey(trimmed)) {
      setCheck(failedCheck(getErrorMessage(API_KEY_INVALID_CODE)));
      return;
    }
    const checkId = checkIdRef.current;
    setCheck(CHECKING_CHECK);
    try {
      await getPlatform().verifyApiKey(trimmed);
      if (checkId !== checkIdRef.current) return;
      setCheck(VERIFIED_CHECK);
    } catch (error) {
      if (checkId !== checkIdRef.current) return;
      const platformError = toPlatformError(error);
      logFailure({ action: "API 키 확인", error: platformError });
      setCheck(failedCheck(getErrorMessage(platformError.code)));
    }
  }, []);

  const handleKeyChange = useCallback(
    (value: string) => {
      setKey(value);
      setSaveErrorMessage(null);
      setCheck(IDLE_CHECK);
      cancelPendingCheck();
      if (isPastingRef.current) {
        isPastingRef.current = false;
        void runCheck(value);
        return;
      }
      checkTimerRef.current = window.setTimeout(() => {
        checkTimerRef.current = null;
        void runCheck(value);
      }, API_KEY_CHECK_DELAY_MS);
    },
    [cancelPendingCheck, runCheck]
  );

  /** 붙여 넣기 뒤에 오는 입력 변경은 기다리지 않고 바로 확인한다. */
  const handlePaste = useCallback(() => {
    isPastingRef.current = true;
  }, []);

  /** 확인한 키를 키체인에 저장한다. 성공하면 입력을 비우고 `true` */
  const saveKey = useCallback(async (): Promise<boolean> => {
    if (check.status !== API_KEY_CHECK_STATUS.VERIFIED) return false;
    setIsSaving(true);
    setSaveErrorMessage(null);
    try {
      setStatus(await getPlatform().saveApiKey(key.trim()));
      cancelPendingCheck();
      setKey("");
      setCheck(IDLE_CHECK);
      toast.success(API_KEY_TEXT.SAVED);
      return true;
    } catch (error) {
      const platformError = toPlatformError(error);
      logFailure({ action: "API 키 저장", error: platformError });
      setSaveErrorMessage(getErrorMessage(platformError.code));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [cancelPendingCheck, check.status, key, setStatus]);

  return {
    key,
    check,
    isSaving,
    saveErrorMessage,
    canSave: check.status === API_KEY_CHECK_STATUS.VERIFIED && !isSaving,
    handleKeyChange,
    handlePaste,
    saveKey
  };
}
