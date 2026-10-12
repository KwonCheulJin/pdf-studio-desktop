import { useCallback, useState } from "react";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError
} from "@/renderer/shared/platform";
import { NOTICES_STATUS } from "../config/notices-status";

interface IdleNotices {
  status: typeof NOTICES_STATUS.IDLE | typeof NOTICES_STATUS.LOADING;
}

interface LoadedNotices {
  status: typeof NOTICES_STATUS.LOADED;
  text: string;
}

interface FailedNotices {
  status: typeof NOTICES_STATUS.FAILED;
  /** 화면 문구(오류 코드로 고른 것) */
  errorMessage: string;
}

export type ThirdPartyNotices = IdleNotices | LoadedNotices | FailedNotices;

const IDLE_NOTICES: ThirdPartyNotices = { status: NOTICES_STATUS.IDLE };
const LOADING_NOTICES: ThirdPartyNotices = { status: NOTICES_STATUS.LOADING };

/** 앱과 함께 번들한 제3자 고지를 처음 열 때 한 번 읽는다. 실패하면 다음에 열 때 다시 읽는다. */
export function useThirdPartyNotices() {
  const [notices, setNotices] = useState<ThirdPartyNotices>(IDLE_NOTICES);

  const loadNotices = useCallback(async () => {
    setNotices(LOADING_NOTICES);
    try {
      const text = await getPlatform().readThirdPartyNotices();
      setNotices({ status: NOTICES_STATUS.LOADED, text });
    } catch (error) {
      const platformError = toPlatformError(error);
      getPlatform().log({
        level: LOG_LEVEL.ERROR,
        message: `제3자 고지 읽기 실패: [${platformError.code}] ${platformError.message}`
      });
      setNotices({
        status: NOTICES_STATUS.FAILED,
        errorMessage: getErrorMessage(platformError.code)
      });
    }
  }, []);

  return { notices, loadNotices };
}
