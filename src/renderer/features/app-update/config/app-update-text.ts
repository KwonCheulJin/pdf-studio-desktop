/** 업데이트 알림 문구. 확인 실패는 화면에 보이지 않고 로그만 남는다. */
export const APP_UPDATE_TEXT = {
  AVAILABLE_TITLE: "새 버전이 나왔어요",
  UPDATE: "업데이트",
  DOWNLOADING_TITLE: "업데이트를 받는 중이에요",
  DOWNLOAD_FAILED_TITLE: "업데이트를 받지 못했어요",
  DOWNLOAD_FAILED_DESCRIPTION: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
  RETRY: "다시 시도",
  WAITING_FOR_WORK_TITLE: "작업이 끝나면 다시 시작해 주세요",
  WAITING_FOR_WORK_DESCRIPTION:
    "업데이트를 받았어요. 진행 중인 병합·비교·내보내기가 끝난 뒤 '다시 시작'을 누르면 설치해요.",
  RESTART: "다시 시작",
  INSTALLING_TITLE: "업데이트를 설치하는 중이에요",
  INSTALL_FAILED_TITLE: "업데이트를 설치하지 못했어요",
  INSTALL_FAILED_DESCRIPTION: "앱을 다시 실행한 뒤 다시 시도해 주세요."
} as const;

export const appUpdateMessage = {
  available: (version: string) =>
    `v${version} · 업데이트하면 앱이 다시 시작되고 열어 둔 파일과 결과는 닫혀요.`,
  downloadPercent: (percent: number) => `${percent}%`
} as const;
