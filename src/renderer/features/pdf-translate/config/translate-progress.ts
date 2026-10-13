import type { TranslateStage } from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";
import { NUMBER_FORMAT } from "./translate-options";

/** 번역 단계(`TranslateProgress.stage`). 이 순서대로 진행한다(ADR 0002 §9). */
export const TRANSLATE_STAGE = {
  READ_DOCUMENT: "readDocument",
  TRANSLATE: "translate",
  ARRANGE: "arrange"
} as const satisfies Record<string, TranslateStage>;

export const TRANSLATE_STAGE_ORDER: readonly TranslateStage[] = [
  TRANSLATE_STAGE.READ_DOCUMENT,
  TRANSLATE_STAGE.TRANSLATE,
  TRANSLATE_STAGE.ARRANGE
];

/** 진행 화면 작업 행 이름(계획서 §9.1.2 진행 단계 표) */
export const TRANSLATE_STAGE_LABEL: Record<TranslateStage, string> = {
  [TRANSLATE_STAGE.READ_DOCUMENT]: "문서 읽기",
  [TRANSLATE_STAGE.TRANSLATE]: "번역",
  [TRANSLATE_STAGE.ARRANGE]: "대역 배치"
};

/** 작업 행 세부의 하는 일(개수를 받기 전·개수가 뜻이 없는 단계) */
export const TRANSLATE_STAGE_DESCRIPTION: Record<TranslateStage, string> = {
  [TRANSLATE_STAGE.READ_DOCUMENT]: "범위 쪽의 문단 찾기",
  [TRANSLATE_STAGE.TRANSLATE]: "묶음마다 Claude API로 보내기",
  [TRANSLATE_STAGE.ARRANGE]: "번역문을 원문 문단에 맞추기"
};

/** `done / total`의 단위(ADR 0002 §9: 범위 쪽 · 묶음 · 범위 쪽) */
export const TRANSLATE_STAGE_COUNT_UNIT: Record<TranslateStage, string> = {
  [TRANSLATE_STAGE.READ_DOCUMENT]: "쪽",
  [TRANSLATE_STAGE.TRANSLATE]: "묶음",
  [TRANSLATE_STAGE.ARRANGE]: "쪽"
};

/** 진행 화면에서 작업 행이 지금 진행과 비교해 어디에 있는지 */
export const STAGE_STATE = {
  DONE: "done",
  ACTIVE: "active",
  PENDING: "pending"
} as const;

export type StageState = ValueOf<typeof STAGE_STATE>;

export const TRANSLATE_PROGRESS_TEXT = {
  RUNNING_TITLE: "번역하는 중",
  RUNNING_HINT: "다른 화면으로 가도 계속 진행돼요",
  OVERALL: "전체 진행률",
  ELAPSED: "경과",
  STAGES: "작업별 진행",
  USAGE_TITLE: "지금까지 사용",
  USAGE_INPUT: "입력",
  USAGE_OUTPUT: "출력",
  TOKENS: "토큰",
  CANCEL: "취소",
  CANCELLING: "취소하는 중...",
  CANCEL_NOTE:
    "취소해도 이미 번역한 묶음의 요금은 청구돼요. 번역된 부분은 남겨 두고 나중에 이어서 할 수 있어요.",
  CANCEL_FAILED_TITLE: "번역을 취소하지 못했어요.",
  FAILED_TITLE: "번역하지 못했어요",
  STOPPED_AT: "멈춘 곳:",
  ERROR_CODE: "오류 코드",
  /** 진행률을 받기 전에 멈췄을 때 멈춘 곳 */
  NOT_STARTED: "시작 전",
  RETRY: "다시 시도(이어서)",
  CLOSE: "닫기",
  CHANGE_KEY: "키 바꾸기",
  /** 결과 화면(Step 46) 자리 */
  DONE_TITLE: "번역을 마쳤어요",
  BACK_TO_OPTIONS: "옵션으로 돌아가기"
} as const;

const DETAIL_SEPARATOR = " · ";

interface RunHeadingParams {
  /** `중국어 → 한국어`. 원문 언어를 모르면 `null` */
  languages: string | null;
  modelName: string;
}

interface StageCountParams {
  stage: TranslateStage;
  done: number;
  total: number;
}

interface LanguagePairParams {
  source: string;
  target: string;
}

interface DoneSummaryParams {
  paragraphs: number;
  inputTokens: number;
  outputTokens: number;
}

interface ParagraphProgressParams {
  done: number;
  total: number;
}

/** 숫자·이름이 들어가는 문구 */
export const translateProgressText = {
  /** 진행 카드 머리에서 파일 이름 뒤(시안 12 `· 중국어 → 한국어 · Sonnet 5.5`) */
  runHeadingSuffix: ({ languages, modelName }: RunHeadingParams) =>
    [languages, modelName]
      .filter((part) => part !== null)
      .map((part) => `${DETAIL_SEPARATOR}${part}`)
      .join(""),
  languages: ({ source, target }: LanguagePairParams) =>
    `${source} → ${target}`,
  stageCount: ({ stage, done, total }: StageCountParams) =>
    `${NUMBER_FORMAT.format(done)} / ${NUMBER_FORMAT.format(total)}${TRANSLATE_STAGE_COUNT_UNIT[stage]}`,
  /** 문서 읽기 세부 뒤쪽(`문단 318개`) */
  paragraphCount: (count: number) => `문단 ${NUMBER_FORMAT.format(count)}개`,
  /** 번역 세부 뒤쪽(`문단 159 / 318`) */
  paragraphProgress: ({ done, total }: ParagraphProgressParams) =>
    `문단 ${NUMBER_FORMAT.format(done)} / ${NUMBER_FORMAT.format(total)}`,
  joinDetail: (parts: readonly string[]) => parts.join(DETAIL_SEPARATOR),
  tokenCount: (count: number) => NUMBER_FORMAT.format(count),
  estimatedTotal: (count: number) =>
    `예상 합계 약 ${NUMBER_FORMAT.format(count)}`,
  /** 결과 화면 자리(Step 46 전): `문단 318개 · 사용 입력 31,420 · 출력 35,880 토큰` */
  doneSummary: ({ paragraphs, inputTokens, outputTokens }: DoneSummaryParams) =>
    `문단 ${NUMBER_FORMAT.format(paragraphs)}개 · 사용 입력 ${NUMBER_FORMAT.format(inputTokens)} · 출력 ${NUMBER_FORMAT.format(outputTokens)} 토큰`
} as const;
