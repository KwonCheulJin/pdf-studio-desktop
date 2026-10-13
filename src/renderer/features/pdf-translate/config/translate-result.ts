import type { TokenUsage } from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";
import { NUMBER_FORMAT } from "./translate-options";
import { translateProgressText } from "./translate-progress";

/** 결과 화면 보기 방식(시안 13 `나란히 | 번역만 | 원문만`) */
export const RESULT_VIEW_MODE = {
  SIDE_BY_SIDE: "sideBySide",
  TARGET_ONLY: "targetOnly",
  SOURCE_ONLY: "sourceOnly"
} as const;

export type ResultViewMode = ValueOf<typeof RESULT_VIEW_MODE>;

/** 결과 글자 크기 배율(%, 계획서 P6-11: 50~200%, 10% 단위, 기본 100%) */
export const RESULT_ZOOM = {
  MIN_PERCENT: 50,
  MAX_PERCENT: 200,
  STEP_PERCENT: 10,
  DEFAULT_PERCENT: 100
} as const;

export const TRANSLATE_RESULT_TEXT = {
  NEW_TRANSLATION: "새 번역",
  BACK_TO_OPTIONS: "옵션으로 돌아가기"
} as const;

const DETAIL_SEPARATOR = " · ";

interface ResultTitleParams {
  /** 확장자를 뺀 파일 이름 */
  baseName: string;
  /** 번역 언어 이름 */
  target: string;
}

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** 숫자·이름이 들어가는 문구 */
export const translateResultText = {
  /** 결과 머리 제목 `产品规格说明书_v3 · 한국어`(파일 이름은 확장자를 뺀다) */
  title: ({ baseName, target }: ResultTitleParams) =>
    `${baseName}${DETAIL_SEPARATOR}${target}`,
  /** 결과 머리 아래 줄 `중국어(간체) → 한국어 · Sonnet 5.5 · 22쪽 · 1분 12초` */
  details: (parts: readonly string[]) => parts.join(DETAIL_SEPARATOR),
  pages: (count: number) => `${NUMBER_FORMAT.format(count)}쪽`,
  /** 이번 실행에 걸린 시간 `1분 12초`, 1분 안이면 `48초`, 초가 0이면 `2분` */
  elapsed: (elapsedMs: number) => {
    const totalSeconds = Math.floor(elapsedMs / MILLISECONDS_PER_SECOND);
    const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;
    if (minutes === 0) return `${seconds}초`;
    return seconds === 0 ? `${minutes}분` : `${minutes}분 ${seconds}초`;
  },
  /** 상태바 왼쪽 `문단 318개` */
  statusParagraphs: translateProgressText.paragraphCount,
  /** 상태바 왼쪽 `사용 입력 31,420 · 출력 35,880 토큰`(기록 누적) */
  statusUsage: ({ inputTokens, outputTokens }: TokenUsage) =>
    `사용 입력 ${NUMBER_FORMAT.format(inputTokens)}${DETAIL_SEPARATOR}출력 ${NUMBER_FORMAT.format(outputTokens)} 토큰`
} as const;
