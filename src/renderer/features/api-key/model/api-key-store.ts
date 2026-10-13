import { toast } from "sonner";
import { create } from "zustand";
import type { ApiKeyStatus } from "@/renderer/shared/api/bindings";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError
} from "@/renderer/shared/platform";
import { API_KEY_TEXT } from "../config/api-key";

interface ApiKeyStoreState {
  /** 등록 상태(끝 4자리 힌트). 읽기 전에는 `null`. 키 원문은 화면에 오지 않는다. */
  status: ApiKeyStatus | null;
}

interface ApiKeyStoreActions {
  setStatus: (status: ApiKeyStatus) => void;
}

export const useApiKeyStore = create<ApiKeyStoreState & ApiKeyStoreActions>(
  (set) => ({
    status: null,
    setStatus: (status) => set({ status })
  })
);

export const useApiKeyStatus = (): ApiKeyStatus | null =>
  useApiKeyStore((state) => state.status);

/** 키 상태를 다시 읽는다(설정 저장소의 힌트만, 키체인을 읽지 않는다 — Q17). */
export async function loadApiKeyStatus(): Promise<void> {
  try {
    useApiKeyStore.getState().setStatus(await getPlatform().getApiKeyStatus());
  } catch (error) {
    const platformError = toPlatformError(error);
    getPlatform().log({
      level: LOG_LEVEL.ERROR,
      message: `API 키 상태 읽기 실패: [${platformError.code}] ${platformError.message}`
    });
    toast.error(API_KEY_TEXT.STATUS_FAILED, {
      description: getErrorMessage(platformError.code)
    });
  }
}
