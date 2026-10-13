import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError
} from "@/renderer/shared/platform";
import { TRANSLATE_SETTINGS_TEXT } from "../config/translate-settings";

/** 저장된 번역(이어하기 기록) 수를 읽고 모두 지운다. 지우면 토스트로 알리고 수를 0으로 바꾼다. */
export function useTranslationRecordsClear() {
  const [isClearing, setIsClearing] = useState(false);
  /** 읽기 전이거나 읽지 못하면 `null`이다(수를 보이지 않는다). */
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let isCurrent = true;
    getPlatform()
      .countTranslationRecords()
      .then((records) => {
        if (isCurrent) setCount(records);
      })
      .catch((error: unknown) => {
        const platformError = toPlatformError(error);
        getPlatform().log({
          level: LOG_LEVEL.WARN,
          message: `저장된 번역 수 읽기 실패: [${platformError.code}] ${platformError.message}`
        });
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  const clearRecords = useCallback(async (): Promise<boolean> => {
    setIsClearing(true);
    try {
      await getPlatform().deleteTranslationRecords();
      setCount(0);
      toast.success(TRANSLATE_SETTINGS_TEXT.RECORDS_CLEARED);
      return true;
    } catch (error) {
      const platformError = toPlatformError(error);
      getPlatform().log({
        level: LOG_LEVEL.ERROR,
        message: `저장된 번역 지우기 실패: [${platformError.code}] ${platformError.message}`
      });
      toast.error(TRANSLATE_SETTINGS_TEXT.RECORDS_CLEAR_FAILED, {
        description: getErrorMessage(platformError.code)
      });
      return false;
    } finally {
      setIsClearing(false);
    }
  }, []);

  return { count, isClearing, clearRecords };
}
