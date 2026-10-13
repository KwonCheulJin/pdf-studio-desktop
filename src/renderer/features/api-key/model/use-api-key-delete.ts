import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError
} from "@/renderer/shared/platform";
import { API_KEY_TEXT } from "../config/api-key";
import { useApiKeyStore } from "./api-key-store";

/** 키체인 항목과 힌트를 지운다. 성공하면 `true` */
export function useApiKeyDelete() {
  const [isDeleting, setIsDeleting] = useState(false);
  const setStatus = useApiKeyStore((state) => state.setStatus);

  const deleteKey = useCallback(async (): Promise<boolean> => {
    setIsDeleting(true);
    try {
      setStatus(await getPlatform().deleteApiKey());
      return true;
    } catch (error) {
      const platformError = toPlatformError(error);
      getPlatform().log({
        level: LOG_LEVEL.ERROR,
        message: `API 키 지우기 실패: [${platformError.code}] ${platformError.message}`
      });
      toast.error(API_KEY_TEXT.DELETE_FAILED, {
        description: getErrorMessage(platformError.code)
      });
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, [setStatus]);

  return { isDeleting, deleteKey };
}
