import { toast } from "sonner";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  type PlatformError
} from "@/renderer/shared/platform";

interface NotifyCompareFailureParams {
  /** 토스트 제목 */
  title: string;
  error: PlatformError;
  /** 로그에만 남길 맥락(경로 등) */
  context: string;
}

/** 비교 파일을 받지 못한 이유를 알린다. 화면에는 코드의 문구를, 로그에는 플랫폼 `message`를 남긴다. */
export function notifyCompareFailure({
  title,
  error,
  context
}: NotifyCompareFailureParams): void {
  getPlatform().log({
    level: LOG_LEVEL.ERROR,
    message: `${context}: [${error.code}] ${error.message}`
  });
  toast.error(title, { description: getErrorMessage(error.code) });
}
