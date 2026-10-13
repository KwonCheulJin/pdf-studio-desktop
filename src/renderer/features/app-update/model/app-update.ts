import { toast, type ExternalToast } from "sonner";
import {
  getPlatform,
  hasRunningWork,
  LOG_LEVEL,
  toPlatformError,
  type AppUpdate
} from "@/renderer/shared/platform";
import type { ValueOf } from "@/renderer/shared/types/common";
import { APP_UPDATE_TEXT, appUpdateMessage } from "../config/app-update-text";
import { downloadPercent } from "../lib/download-percent";

/** 업데이트 알림은 토스트 하나를 같은 ID로 바꿔 가며 보인다. */
const UPDATE_TOAST_ID = "app-update";

/** 사용자가 고르거나 끝날 때까지 남긴다. */
const PERSISTENT_DURATION_MS = Infinity;

const UPDATE_TOAST_TYPE = {
  INFO: "info",
  LOADING: "loading",
  ERROR: "error"
} as const;

type UpdateToastType = ValueOf<typeof UPDATE_TOAST_TYPE>;

const SHOW_TOAST: Record<
  UpdateToastType,
  (title: string, options: ExternalToast) => void
> = {
  [UPDATE_TOAST_TYPE.INFO]: toast.info,
  [UPDATE_TOAST_TYPE.LOADING]: toast.loading,
  [UPDATE_TOAST_TYPE.ERROR]: toast.error
};

interface UpdateToastAction {
  label: string;
  onClick: () => void;
}

interface UpdateToastParams {
  type: UpdateToastType;
  title: string;
  description?: string;
  action?: UpdateToastAction;
}

/**
 * 업데이트 토스트를 보이거나 바꾼다. 같은 ID의 옵션은 합쳐지므로 설명·행동은 없을 때도
 * `undefined`로 덮는다. 행동을 눌러도 토스트를 닫지 않고 다음 상태로 바꾼다.
 */
function showUpdateToast({
  type,
  title,
  description,
  action
}: UpdateToastParams): void {
  SHOW_TOAST[type](title, {
    id: UPDATE_TOAST_ID,
    description,
    duration: PERSISTENT_DURATION_MS,
    action: action && {
      label: action.label,
      onClick: (event) => {
        event.preventDefault();
        action.onClick();
      }
    }
  });
}

interface LogUpdateFailureParams {
  context: string;
  error: unknown;
}

function logUpdateFailure({ context, error }: LogUpdateFailureParams): void {
  const platformError = toPlatformError(error);
  getPlatform().log({
    level: LOG_LEVEL.WARN,
    message: `${context}: [${platformError.code}] ${platformError.message}`
  });
}

/** 진행 중인 작업이 있으면 재시작하지 않고, 끝난 뒤 '다시 시작'을 누르게 한다. */
async function restartWhenIdle(update: AppUpdate): Promise<void> {
  if (hasRunningWork()) {
    showUpdateToast({
      type: UPDATE_TOAST_TYPE.INFO,
      title: APP_UPDATE_TEXT.WAITING_FOR_WORK_TITLE,
      description: APP_UPDATE_TEXT.WAITING_FOR_WORK_DESCRIPTION,
      action: {
        label: APP_UPDATE_TEXT.RESTART,
        onClick: () => void restartWhenIdle(update)
      }
    });
    return;
  }
  showUpdateToast({
    type: UPDATE_TOAST_TYPE.LOADING,
    title: APP_UPDATE_TEXT.INSTALLING_TITLE
  });
  try {
    await update.installAndRestart();
  } catch (error) {
    logUpdateFailure({ context: "업데이트 설치 실패", error });
    showUpdateToast({
      type: UPDATE_TOAST_TYPE.ERROR,
      title: APP_UPDATE_TEXT.INSTALL_FAILED_TITLE,
      description: APP_UPDATE_TEXT.INSTALL_FAILED_DESCRIPTION
    });
  }
}

/** 받는 동안 %를 보이고, 다 받으면 설치·재시작으로 넘어간다. */
async function downloadUpdate(update: AppUpdate): Promise<void> {
  showUpdateToast({
    type: UPDATE_TOAST_TYPE.LOADING,
    title: APP_UPDATE_TEXT.DOWNLOADING_TITLE
  });
  try {
    await update.download((progress) => {
      const percent = downloadPercent(progress);
      showUpdateToast({
        type: UPDATE_TOAST_TYPE.LOADING,
        title: APP_UPDATE_TEXT.DOWNLOADING_TITLE,
        description:
          percent === null
            ? undefined
            : appUpdateMessage.downloadPercent(percent)
      });
    });
  } catch (error) {
    logUpdateFailure({ context: "업데이트 받기 실패", error });
    showUpdateToast({
      type: UPDATE_TOAST_TYPE.ERROR,
      title: APP_UPDATE_TEXT.DOWNLOAD_FAILED_TITLE,
      description: APP_UPDATE_TEXT.DOWNLOAD_FAILED_DESCRIPTION,
      action: {
        label: APP_UPDATE_TEXT.RETRY,
        onClick: () => void downloadUpdate(update)
      }
    });
    return;
  }
  await restartWhenIdle(update);
}

/** 확인이 실패하면 화면에 보이지 않고 로그만 남긴다. */
async function findUpdate(): Promise<AppUpdate | null> {
  try {
    return await getPlatform().checkForUpdate();
  } catch (error) {
    logUpdateFailure({ context: "업데이트 확인 실패", error });
    return null;
  }
}

/** 새 버전을 찾으면 알린다. */
async function checkForUpdate(): Promise<void> {
  const update = await findUpdate();
  if (update === null) return;
  showUpdateToast({
    type: UPDATE_TOAST_TYPE.INFO,
    title: APP_UPDATE_TEXT.AVAILABLE_TITLE,
    description: appUpdateMessage.available(update.version),
    action: {
      label: APP_UPDATE_TEXT.UPDATE,
      onClick: () => void downloadUpdate(update)
    }
  });
}

/** 한 번 실행 중에 두 번 확인하지 않도록 첫 확인을 기억한다. */
let updateCheck: Promise<void> | null = null;

/**
 * 앱을 시작한 뒤 한 번 업데이트를 확인한다(계획서 P4-4).
 * 토스트는 `Toaster`가 붙은 뒤에 띄워야 보이므로 화면이 붙은 다음에 부른다.
 */
export function checkForUpdateOnce(): Promise<void> {
  updateCheck ??= checkForUpdate();
  return updateCheck;
}
