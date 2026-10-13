/** 플랫폼 설정 저장소에서 오류 보고 설정을 두는 키 */
export const ERROR_REPORTING_SETTING_KEY = {
  /** 사용자가 오류 보고를 켜 두었는지. 없으면 켜짐 */
  ENABLED: "errorReporting.enabled",
  /** 첫 실행 안내를 이미 보였는지 */
  NOTICE_SHOWN: "errorReporting.noticeShown"
} as const;

/** 저장된 값이 없을 때(첫 실행). 첫 실행 안내에서 바로 끌 수 있다. */
export const DEFAULT_ERROR_REPORTING_ENABLED = true;

export const ERROR_REPORTING_NOTICE = {
  TITLE: "오류가 나면 개발자에게 알립니다.",
  DESCRIPTION:
    "오류 내용(메시지·발생 위치)과 앱 환경 정보만 보내고 화면 캡처는 보내지 않습니다. 파일 경로·이름은 지운 뒤 보냅니다. 이 안내의 끄기나 아래 도구 막대의 오류 보고 버튼으로 끌 수 있습니다.",
  TURN_OFF: "끄기"
} as const;

/** 설정 › 오류 보고 탭(계획서 P6-8, ADR 0002 §12) */
export const ERROR_REPORTING_SETTING_TEXT = {
  ENABLE: "오류가 나면 개발자에게 알리기",
  ENABLE_DESCRIPTION:
    "앱이 멈추거나 처리에 실패했을 때 원인을 고치는 데 써요. 끄면 아무것도 보내지 않아요.",
  SENT_TITLE: "보내는 것",
  SENT: ["오류 내용(메시지·발생 위치)", "앱 버전과 실행 환경 정보"],
  NOT_SENT_TITLE: "보내지 않는 것",
  NOT_SENT: [
    "화면 캡처",
    "파일 경로·이름(지운 뒤 보내요)",
    "문서 내용",
    "번역 문서 내용과 API 키"
  ]
} as const;
