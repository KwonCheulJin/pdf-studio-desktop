import type { ValueOf } from "@/renderer/shared/types/common";

/** 설정 모달 탭(계획서 P6-8, Q9) */
export const SETTINGS_TAB = {
  GENERAL: "general",
  TRANSLATE: "translate",
  ERROR_REPORTING: "errorReporting",
  ABOUT: "about"
} as const;

export type SettingsTab = ValueOf<typeof SETTINGS_TAB>;

/** 탭 목록 순서(오류 보고 기능이 없는 빌드면 오류 보고 탭을 뺀다) */
export const SETTINGS_TAB_ORDER: readonly SettingsTab[] = [
  SETTINGS_TAB.GENERAL,
  SETTINGS_TAB.TRANSLATE,
  SETTINGS_TAB.ERROR_REPORTING,
  SETTINGS_TAB.ABOUT
];

export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  [SETTINGS_TAB.GENERAL]: "일반",
  [SETTINGS_TAB.TRANSLATE]: "번역",
  [SETTINGS_TAB.ERROR_REPORTING]: "오류 보고",
  [SETTINGS_TAB.ABOUT]: "정보"
};

export const SETTINGS_TEXT = {
  TITLE: "설정",
  TAB_LIST: "설정 항목",
  CLOSE: "닫기",
  GLOSSARY_EDITOR_TITLE: "공용 용어집",
  BACK_TO_TRANSLATE: "번역 설정으로 돌아가기",
  USAGE_NOTE:
    "사용량과 요금은 Anthropic 콘솔(platform.claude.com)에서 확인할 수 있어요.",
  APP_NAME: "PDF Studio",
  VERSION: "버전",
  LICENSES: "라이선스",
  REPOSITORY: "저장소",
  REPOSITORY_ADDRESS: "github.com/KwonCheulJin/pdf-studio-desktop"
} as const;

/** 탭 목록에서 앞뒤 탭으로 옮기는 키(세로 목록) */
export const TAB_ARROW_STEP: Record<string, number> = {
  ArrowUp: -1,
  ArrowDown: 1
};
