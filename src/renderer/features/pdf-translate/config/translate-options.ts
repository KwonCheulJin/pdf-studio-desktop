import {
  SOURCE_LANGUAGE,
  SOURCE_LANGUAGE_LABEL
} from "@/renderer/entities/translation";
import type { SourceLanguage } from "@/renderer/shared/api/bindings";
import {
  PAGE_RANGE_ERROR,
  type PageRangeError
} from "@/renderer/shared/lib/page-range-parse";
import type { SegmentedOption } from "@/renderer/shared/ui";

/** 원문 언어 세그먼트(시안 10 `자동 감지 | 중국어 | 영어`) */
export const SOURCE_LANGUAGE_OPTIONS: readonly SegmentedOption<SourceLanguage>[] =
  [SOURCE_LANGUAGE.AUTO, SOURCE_LANGUAGE.ZH, SOURCE_LANGUAGE.EN].map(
    (language) => ({ value: language, label: SOURCE_LANGUAGE_LABEL[language] })
  );

/** 설정 저장소에서 "키를 등록한 뒤 외부 전송을 한 번 확인했는가"를 두는 키(ADR 0002 §13) */
export const TRANSFER_CONFIRMED_ONCE_SETTING =
  "translate.transferConfirmedOnce";

/** 1 USD = 1,000,000 micro USD(`TranslationPlan.estimatedCostMicroUsd`) */
const MICRO_USD_PER_USD = 1_000_000;
/** 예상 요금은 센트까지 보인다. 1센트보다 작으면 "미만"으로 */
const COST_FRACTION_DIGITS = 2;
const MIN_SHOWN_COST_MICRO_USD = 10_000;

/** 개수·토큰 수 표기(천 단위 쉼표) */
export const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

export const TRANSLATE_OPTIONS_TEXT = {
  OPTIONS_TITLE: "번역 옵션",
  SOURCE_LANGUAGE: "원문 언어",
  TARGET_LANGUAGE: "번역 언어",
  RANGE: "페이지 범위",
  RANGE_PLACEHOLDER: "전체 (예: 1,3-5)",
  MODEL: "모델",
  GLOSSARY: "용어집",
  GLOSSARY_NOTE: "제품명·고유명사를 정해 두면 문서 전체에서 같게 번역해요.",
  SCAN_PAGES: "스캔 페이지",
  SCAN_TOKEN_NOTE: "(토큰이 더 들어요)",
  NO_SCAN_PAGES: "스캔 쪽 없음",
  SUMMARY_TITLE: "실행 전 확인",
  SUMMARY_PAGES: "번역할 쪽",
  SUMMARY_PARAGRAPHS: "문단",
  SUMMARY_INPUT: "예상 입력",
  SUMMARY_OUTPUT: "예상 출력",
  SUMMARY_COST: "예상 요금",
  /** 계획을 받는 동안 숫자 자리(계획서 §9.1.6) */
  PENDING: "…",
  /** 문서가 없거나 범위가 틀려 계획을 받지 않을 때·언어를 몰라 예상치가 없을 때 */
  UNAVAILABLE: "—",
  BILLING_NOTE:
    "요금은 내 Claude API 계정에 사용한 토큰만큼 청구돼요. 예상치는 실제와 다를 수 있어요.",
  CONSENT: "문서 내용이 번역을 위해 Anthropic API로 전송되는 것을 확인했어요.",
  CONSENT_OFF: "외부 전송 확인을 껐어요",
  OPEN_SETTINGS: "설정",
  /** 머리 톱니("설정")와 구분하는 접근 가능한 이름(보이는 글자 "설정"을 담는다) */
  OPEN_SETTINGS_LABEL: "번역 설정 열기",
  START: "번역 시작",
  VIEW_RESULT: "결과 보기",
  ALREADY_TRANSLATED: "이미 번역한 문서예요 · 추가 요금 없음",
  REASON_NO_FILE: "번역할 PDF를 넣어 주세요.",
  REASON_INVALID_RANGE: "페이지 범위를 고치면 시작할 수 있어요.",
  REASON_UNKNOWN_LANGUAGE: "원문 언어를 골라 주세요.",
  REASON_NOTHING_TO_TRANSLATE: "범위 안에 번역할 글이 없어요.",
  REASON_SCAN_ONLY: "스캔 페이지 옵션을 켜면 번역할 수 있어요.",
  REASON_NO_CONSENT: "전송을 확인하면 시작할 수 있어요.",
  UNKNOWN_LANGUAGE_BADGE: "언어를 알 수 없어요",
  PLAN_FAILED_TITLE: "번역 계획을 세우지 못했어요."
} as const;

/** 쪽 범위 오류 문구(비교 옵션과 같은 문구, 계획서 P6-9). 쪽 수를 넘을 때만 쪽 수를 넣는다. */
const RANGE_ERROR_MESSAGE: Record<
  Exclude<PageRangeError, typeof PAGE_RANGE_ERROR.EXCEEDS_PAGE_COUNT>,
  string
> = {
  [PAGE_RANGE_ERROR.FORMAT]: "쪽 번호는 1부터 1,3-5처럼 써 주세요.",
  [PAGE_RANGE_ERROR.REVERSED]: "구간은 작은 쪽부터 써 주세요(예: 3-5)."
};

interface RangeErrorMessageParams {
  error: PageRangeError;
  pageCount: number;
}

export function rangeErrorMessage({
  error,
  pageCount
}: RangeErrorMessageParams): string {
  return error === PAGE_RANGE_ERROR.EXCEEDS_PAGE_COUNT
    ? `이 문서는 ${pageCount}쪽까지 있어요. 범위를 줄이세요.`
    : RANGE_ERROR_MESSAGE[error];
}

interface ResumeCounts {
  translatedParagraphs: number;
  paragraphCount: number;
}

interface PlanCounts {
  paragraphs: number;
  chunks: number;
}

interface PageCounts {
  textPages: number;
  scanPages: number;
}

/** 숫자·이름이 들어가는 문구 */
export const translateOptionsText = {
  pageCount: (count: number) => `/ ${count}쪽`,
  /** 파일 카드 mono 줄 뒤쪽(시안 10 `글자층 22쪽 / 스캔 2쪽`) */
  pageKinds: ({ textPages, scanPages }: PageCounts) =>
    `글자층 ${textPages}쪽 / 스캔 ${scanPages}쪽`,
  detectedBadge: (language: string) => `감지: ${language}`,
  scanOption: (count: string) =>
    `글자층이 없는 ${count}쪽은 페이지 이미지를 읽어 번역`,
  sharedGlossary: (count: number) => `공용 용어 ${count}개도 함께 적용해요`,
  pages: (count: number) => `${count}쪽`,
  paragraphs: ({ paragraphs, chunks }: PlanCounts) =>
    `${NUMBER_FORMAT.format(paragraphs)}개 · ${NUMBER_FORMAT.format(chunks)}묶음`,
  tokens: (count: number) => `약 ${NUMBER_FORMAT.format(count)} 토큰`,
  cost: (microUsd: number) =>
    microUsd > 0 && microUsd < MIN_SHOWN_COST_MICRO_USD
      ? `$${(MIN_SHOWN_COST_MICRO_USD / MICRO_USD_PER_USD).toFixed(COST_FRACTION_DIGITS)} 미만`
      : `약 $${(microUsd / MICRO_USD_PER_USD).toFixed(COST_FRACTION_DIGITS)}`,
  pricingDate: (date: string) => `요금표 기준일 ${date}.`,
  resumable: ({ translatedParagraphs, paragraphCount }: ResumeCounts) =>
    `번역한 문단 ${NUMBER_FORMAT.format(translatedParagraphs)} / ${NUMBER_FORMAT.format(paragraphCount)}개가 남아 있어요. 번역 시작하면 이어서 해요.`
} as const;
