import { toast } from "sonner";
import { create } from "zustand";
import { isErrorReportingAvailable } from "@/renderer/shared/lib/error-report";
import { getPlatform, LOG_LEVEL } from "@/renderer/shared/platform";
import {
  DEFAULT_ERROR_REPORTING_ENABLED,
  ERROR_REPORTING_NOTICE,
  ERROR_REPORTING_SETTING_KEY
} from "../config/error-reporting-setting";

/** 안내 토스트는 사용자가 닫거나 끌 때까지 남긴다. */
const NOTICE_DURATION_MS = Infinity;

interface ErrorReportingStoreState {
  /** 저장된 설정을 읽기 전에는 보내지 않는다(`false`). */
  isEnabled: boolean;
}

interface ErrorReportingStoreActions {
  /** 오류 보고를 켜거나 끄고 플랫폼 설정 저장소에 남긴다. */
  setEnabled: (isEnabled: boolean) => void;
}

type ErrorReportingStore = ErrorReportingStoreState &
  ErrorReportingStoreActions;

interface SaveSettingParams {
  key: string;
  value: boolean;
}

function saveSetting({ key, value }: SaveSettingParams): void {
  getPlatform()
    .setSetting({ key, value })
    .catch((error: unknown) => {
      getPlatform().log({
        level: LOG_LEVEL.WARN,
        message: `오류 보고 설정 저장 실패(${key}): ${String(error)}`
      });
    });
}

async function readBooleanSetting(key: string): Promise<boolean | null> {
  try {
    const stored = await getPlatform().getSetting(key);
    return typeof stored === "boolean" ? stored : null;
  } catch (error) {
    getPlatform().log({
      level: LOG_LEVEL.WARN,
      message: `오류 보고 설정 읽기 실패(${key}): ${String(error)}`
    });
    return null;
  }
}

export const useErrorReportingStore = create<ErrorReportingStore>((set) => ({
  isEnabled: false,

  setEnabled: (isEnabled) => {
    set({ isEnabled });
    saveSetting({ key: ERROR_REPORTING_SETTING_KEY.ENABLED, value: isEnabled });
  }
}));

export const useIsErrorReportingEnabled = (): boolean =>
  useErrorReportingStore((state) => state.isEnabled);

/** 오류 보고기가 보낼 때마다 묻는 현재 설정 */
export function isErrorReportingEnabled(): boolean {
  return useErrorReportingStore.getState().isEnabled;
}

/** 부팅 때 저장된 설정을 읽는다. 오류 보고 기능이 없는 빌드면 읽지 않는다. */
export async function loadErrorReportingSetting(): Promise<void> {
  if (!isErrorReportingAvailable()) return;
  const stored = await readBooleanSetting(ERROR_REPORTING_SETTING_KEY.ENABLED);
  useErrorReportingStore.setState({
    isEnabled: stored ?? DEFAULT_ERROR_REPORTING_ENABLED
  });
}

async function showNoticeIfFirstRun(): Promise<void> {
  const isShown = await readBooleanSetting(
    ERROR_REPORTING_SETTING_KEY.NOTICE_SHOWN
  );
  if (isShown) return;
  toast.info(ERROR_REPORTING_NOTICE.TITLE, {
    description: ERROR_REPORTING_NOTICE.DESCRIPTION,
    duration: NOTICE_DURATION_MS,
    action: {
      label: ERROR_REPORTING_NOTICE.TURN_OFF,
      onClick: () => useErrorReportingStore.getState().setEnabled(false)
    }
  });
  saveSetting({ key: ERROR_REPORTING_SETTING_KEY.NOTICE_SHOWN, value: true });
}

/** 한 번 실행 중에 안내를 두 번 띄우지 않도록 첫 확인을 기억한다. */
let noticeCheck: Promise<void> | null = null;

/**
 * 오류 보고 기능이 있는 빌드에서 처음 실행할 때 한 번 안내한다. 안내에서 바로 끌 수 있다.
 * 토스트는 `Toaster`가 붙은 뒤에 띄워야 보이므로 화면이 붙은 다음에 부른다.
 */
export function showErrorReportingNoticeOnce(): Promise<void> {
  if (!isErrorReportingAvailable()) return Promise.resolve();
  noticeCheck ??= showNoticeIfFirstRun();
  return noticeCheck;
}
