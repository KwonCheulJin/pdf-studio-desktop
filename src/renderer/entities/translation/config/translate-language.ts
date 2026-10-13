import type {
  DetectedLanguage,
  SourceLanguage
} from "@/renderer/shared/api/bindings";

/** 원문 언어 고르기(계약 값, 옵션 화면 `자동 감지 | 중국어 | 영어`) */
export const SOURCE_LANGUAGE = {
  AUTO: "auto",
  ZH: "zh",
  EN: "en"
} as const satisfies Record<string, SourceLanguage>;

export const SOURCE_LANGUAGE_LABEL: Record<SourceLanguage, string> = {
  [SOURCE_LANGUAGE.AUTO]: "자동 감지",
  [SOURCE_LANGUAGE.ZH]: "중국어",
  [SOURCE_LANGUAGE.EN]: "영어"
};

/** 감지한 언어(계약 값). 간체·번체는 표시용이고 요청은 "중국어"다. */
export const DETECTED_LANGUAGE = {
  ZH_HANS: "zhHans",
  ZH_HANT: "zhHant",
  ZH: "zh",
  EN: "en",
  UNKNOWN: "unknown"
} as const satisfies Record<string, DetectedLanguage>;

/** 감지 배지·결과 머리에 보이는 이름(시안 10 "감지: 중국어(간체)"). 모름은 이름이 없다. */
export const DETECTED_LANGUAGE_LABEL: Record<
  Exclude<DetectedLanguage, typeof DETECTED_LANGUAGE.UNKNOWN>,
  string
> = {
  [DETECTED_LANGUAGE.ZH_HANS]: "중국어(간체)",
  [DETECTED_LANGUAGE.ZH_HANT]: "중국어(번체)",
  [DETECTED_LANGUAGE.ZH]: "중국어",
  [DETECTED_LANGUAGE.EN]: "영어"
};

/** 번역 언어(고정, 계획서 §9.1.1) */
export const TARGET_LANGUAGE_LABEL = "한국어";

/** 감지한 언어의 요청 언어(상태바 `중국어 → 한국어`). 모름이면 `null` */
export function baseSourceLanguageOf(
  detected: DetectedLanguage
): SourceLanguage | null {
  switch (detected) {
    case DETECTED_LANGUAGE.ZH_HANS:
    case DETECTED_LANGUAGE.ZH_HANT:
    case DETECTED_LANGUAGE.ZH:
      return SOURCE_LANGUAGE.ZH;
    case DETECTED_LANGUAGE.EN:
      return SOURCE_LANGUAGE.EN;
    default:
      return null;
  }
}
