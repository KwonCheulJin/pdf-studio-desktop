import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError
} from "@/renderer/shared/platform";
import { TRANSLATE_SETTINGS_TEXT } from "../config/translate-settings";

/** 저장된 번역(이어하기 기록)을 모두 지운다. 끝나면 토스트로 알린다. */
export function useTranslationRecordsClear() {
  const [isClearing, setIsClearing] = useState(false);

  const clearRecords = useCallback(async (): Promise<boolean> => {
    setIsClearing(true);
    try {
      await getPlatform().deleteTranslationRecords();
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

  return { isClearing, clearRecords };
}
