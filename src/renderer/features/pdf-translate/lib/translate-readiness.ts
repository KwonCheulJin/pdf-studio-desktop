import {
  DETECTED_LANGUAGE,
  SOURCE_LANGUAGE
} from "@/renderer/entities/translation";
import type {
  ApiKeyStatus,
  TranslateOptions,
  TranslationPlan
} from "@/renderer/shared/api/bindings";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import type { PageRangeError } from "@/renderer/shared/lib/page-range-parse";
import type { ValueOf } from "@/renderer/shared/types/common";
import { TRANSLATE_OPTIONS_TEXT } from "../config/translate-options";
import {
  PLAN_STATUS,
  type TranslationPlanState
} from "../model/use-translation-plan";

/** "번역 시작" 버튼이 할 일 */
export const TRANSLATE_ACTION = {
  /** 막힘(이유가 있으면 바닥에 보인다) */
  BLOCKED: "blocked",
  /** 키가 없다. 버튼은 켜져 있고 누르면 키 모달 */
  OPEN_API_KEY: "openApiKey",
  START: "start",
  /** 모든 문단이 이미 번역된 기록. 보낼 것이 없어 동의를 받지 않는다. */
  VIEW_RESULT: "viewResult"
} as const;

export type TranslateAction = ValueOf<typeof TRANSLATE_ACTION>;

export interface TranslateReadiness {
  action: TranslateAction;
  /** 바닥에 보일 막힘 이유. 없으면 `null` */
  reason: string | null;
}

interface TranslateReadinessParams {
  hasFile: boolean;
  /** 결과 화면의 문단 다시 번역이 도는 중(번역은 한 번에 하나, ADR 0002 §10) */
  isRetranslating: boolean;
  rangeError: PageRangeError | null;
  options: TranslateOptions;
  planState: TranslationPlanState;
  /** 읽기 전이면 `null` */
  apiKeyStatus: ApiKeyStatus | null;
  isConsentRequired: boolean;
  isConsentChecked: boolean;
}

function blocked(reason: string | null): TranslateReadiness {
  return { action: TRANSLATE_ACTION.BLOCKED, reason };
}

/** 이어하기 기록에 모든 문단이 있어 보낼 것이 없다(Step 41: 예상 입력 0 + 이어하기). */
export function isAlreadyTranslated(plan: TranslationPlan): boolean {
  return plan.resumable !== null && plan.estimatedInputTokens === 0;
}

interface PlanCheckParams {
  options: TranslateOptions;
  plan: TranslationPlan;
}

/** 원문 언어를 자동 감지로 두었는데 감지하지 못했다(예상치 0, Rust는 `SOURCE_LANGUAGE_UNKNOWN`). */
export function isSourceLanguageUnknown({
  options,
  plan
}: PlanCheckParams): boolean {
  return (
    options.sourceLanguage === SOURCE_LANGUAGE.AUTO &&
    plan.detectedLanguage === DETECTED_LANGUAGE.UNKNOWN
  );
}

/** 계획으로 본 막힘(언어 → 번역할 것). 없으면 `null` */
function planBlockReason({ options, plan }: PlanCheckParams): string | null {
  if (isSourceLanguageUnknown({ options, plan })) {
    return TRANSLATE_OPTIONS_TEXT.REASON_UNKNOWN_LANGUAGE;
  }
  // 묶음은 글자층 문단과(옵션을 켰을 때) 스캔 쪽으로 만든다. 없으면 Rust는 `NO_TRANSLATABLE_TEXT`다.
  if (plan.chunkCount === 0) {
    return !options.includeScanPages && plan.scanPages > 0
      ? TRANSLATE_OPTIONS_TEXT.REASON_SCAN_ONLY
      : TRANSLATE_OPTIONS_TEXT.REASON_NOTHING_TO_TRANSLATE;
  }
  return null;
}

/**
 * 실행 전 확인 바닥의 막힘 이유(계획서 §9.1.6 "시안에 없는 상태"), 위에서부터 하나:
 * 파일 없음 → 문단 다시 번역 중 → 범위 오류 → (계획을 받는 중·실패) → 언어 모름 → 번역할 것 없음 → 키 없음(버튼은 켜져 있고
 * 키 모달) → 동의 없음. 모든 문단이 이미 번역됐으면 동의 없이 "결과 보기"다.
 */
export function translateReadinessOf({
  hasFile,
  isRetranslating,
  rangeError,
  options,
  planState,
  apiKeyStatus,
  isConsentRequired,
  isConsentChecked
}: TranslateReadinessParams): TranslateReadiness {
  if (!hasFile) return blocked(TRANSLATE_OPTIONS_TEXT.REASON_NO_FILE);
  if (isRetranslating) {
    return blocked(TRANSLATE_OPTIONS_TEXT.REASON_RETRANSLATING);
  }
  if (rangeError !== null) {
    return blocked(TRANSLATE_OPTIONS_TEXT.REASON_INVALID_RANGE);
  }
  if (planState.status === PLAN_STATUS.FAILED) {
    return blocked(getErrorMessage(planState.errorCode));
  }
  if (planState.status !== PLAN_STATUS.READY) return blocked(null);
  const { plan } = planState;
  const planReason = planBlockReason({ options, plan });
  if (planReason !== null) return blocked(planReason);
  if (apiKeyStatus === null) return blocked(null);
  if (!apiKeyStatus.registered) {
    return { action: TRANSLATE_ACTION.OPEN_API_KEY, reason: null };
  }
  if (isAlreadyTranslated(plan)) {
    return { action: TRANSLATE_ACTION.VIEW_RESULT, reason: null };
  }
  if (isConsentRequired && !isConsentChecked) {
    return blocked(TRANSLATE_OPTIONS_TEXT.REASON_NO_CONSENT);
  }
  return { action: TRANSLATE_ACTION.START, reason: null };
}
