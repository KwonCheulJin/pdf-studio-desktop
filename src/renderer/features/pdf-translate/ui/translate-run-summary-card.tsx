import { useEffect, useId, type ReactNode } from "react";
import { Play } from "lucide-react";
import type {
  ApiKeyStatus,
  TranslateOptions,
  TranslationPlan
} from "@/renderer/shared/api/bindings";
import { Button, Checkbox } from "@/renderer/shared/ui";
import {
  TRANSLATE_OPTIONS_TEXT,
  translateOptionsText
} from "../config/translate-options";
import {
  isAlreadyTranslated,
  isSourceLanguageUnknown,
  TRANSLATE_ACTION,
  translateReadinessOf
} from "../lib/translate-readiness";
import { translateRangeErrorOf } from "../lib/translate-range";
import {
  isTransferConsentRequired,
  loadTransferConfirmedOnce,
  useTransferConsentStore
} from "../model/transfer-consent-store";
import {
  useTranslateFile,
  useTranslateSessionStore
} from "../model/translate-session-store";
import { useTranslateExecution } from "../model/use-translate-execution";
import {
  PLAN_STATUS,
  type TranslationPlanState
} from "../model/use-translation-plan";

const PLAY_ICON_SIZE = 16;

interface SummaryValues {
  pages: string;
  paragraphs: string;
  inputTokens: string;
  outputTokens: string;
  cost: string;
}

function placeholderValues(text: string): SummaryValues {
  return {
    pages: text,
    paragraphs: text,
    inputTokens: text,
    outputTokens: text,
    cost: text
  };
}

interface PlanValuesParams {
  plan: TranslationPlan;
  options: TranslateOptions;
}

/** 계획 응답 그대로의 값. 원문 언어를 몰라 예상치가 없으면 예상 칸은 "—" */
function planValues({ plan, options }: PlanValuesParams): SummaryValues {
  const hasEstimate = !isSourceLanguageUnknown({ options, plan });
  return {
    pages: translateOptionsText.pages(plan.rangePages),
    paragraphs: translateOptionsText.paragraphs({
      paragraphs: plan.paragraphCount,
      chunks: plan.chunkCount
    }),
    inputTokens: hasEstimate
      ? translateOptionsText.tokens(plan.estimatedInputTokens)
      : TRANSLATE_OPTIONS_TEXT.UNAVAILABLE,
    outputTokens: hasEstimate
      ? translateOptionsText.tokens(plan.estimatedOutputTokens)
      : TRANSLATE_OPTIONS_TEXT.UNAVAILABLE,
    cost: hasEstimate
      ? translateOptionsText.cost(plan.estimatedCostMicroUsd)
      : TRANSLATE_OPTIONS_TEXT.UNAVAILABLE
  };
}

interface SummaryValuesParams {
  planState: TranslationPlanState;
  options: TranslateOptions;
}

function summaryValuesOf({
  planState,
  options
}: SummaryValuesParams): SummaryValues {
  switch (planState.status) {
    case PLAN_STATUS.READY:
      return planValues({ plan: planState.plan, options });
    case PLAN_STATUS.LOADING:
      return placeholderValues(TRANSLATE_OPTIONS_TEXT.PENDING);
    default:
      return placeholderValues(TRANSLATE_OPTIONS_TEXT.UNAVAILABLE);
  }
}

interface SummaryRow {
  label: string;
  value: string;
}

interface ResumeNoticeProps {
  plan: TranslationPlan;
}

/** 이어하기 기록 안내: 다 번역됐으면 "이미 번역한 문서예요", 일부면 남은 문단 수 */
function ResumeNotice({ plan }: ResumeNoticeProps) {
  if (plan.resumable === null) return null;
  return (
    <p className="bg-accent text-accent-foreground rounded-md px-3 py-2 text-xs/4.5">
      {isAlreadyTranslated(plan)
        ? TRANSLATE_OPTIONS_TEXT.ALREADY_TRANSLATED
        : translateOptionsText.resumable(plan.resumable)}
    </p>
  );
}

interface TranslateRunSummaryCardProps {
  /** 계획·번역 요청에 싣는 옵션(공용 용어 합침, 기본 모델 반영) */
  options: TranslateOptions;
  planState: TranslationPlanState;
  /** 읽기 전이면 `null` */
  apiKeyStatus: ApiKeyStatus | null;
  /** 키 행(등록됨 + 바꾸기 / 없음 + 등록). 키 모달은 화면이 연다. */
  apiKeyRow: ReactNode;
  /** 설정 "번역 전에 외부 전송 확인 받기" */
  confirmExternalTransfer: boolean;
  /** 키 없이 "번역 시작"을 누르면 키 모달을 연다. */
  onRequestApiKey: () => void;
  /** "외부 전송 확인을 껐어요 · 설정"의 설정(번역 탭) */
  onOpenTranslateSettings: () => void;
}

/**
 * 실행 전 확인 카드(시안 10 오른쪽): 계획 응답(쪽·문단·묶음·예상 토큰·요금), 키 행, 외부 전송 동의,
 * "번역 시작"과 막힘 이유(계획서 §9.1.6).
 */
export function TranslateRunSummaryCard({
  options,
  planState,
  apiKeyStatus,
  apiKeyRow,
  confirmExternalTransfer,
  onRequestApiKey,
  onOpenTranslateSettings
}: TranslateRunSummaryCardProps) {
  const titleId = useId();
  const reasonId = useId();
  const file = useTranslateFile();
  const isConsentChecked = useTranslateSessionStore(
    (state) => state.isTransferConsentChecked
  );
  const setConsentChecked = useTranslateSessionStore(
    (state) => state.setTransferConsentChecked
  );
  const isConfirmedOnce = useTransferConsentStore(
    (state) => state.isConfirmedOnce
  );
  const { startTranslation } = useTranslateExecution();

  // 키를 저장하면 Rust가 확인 기록을 되돌리므로(ADR 0002 §13) 키 상태가 바뀔 때마다 다시 읽는다.
  useEffect(() => {
    void loadTransferConfirmedOnce();
  }, [apiKeyStatus]);

  const isConsentRequired = isTransferConsentRequired({
    confirmExternalTransfer,
    isConfirmedOnce
  });
  const readiness = translateReadinessOf({
    hasFile: file !== null,
    rangeError: translateRangeErrorOf({ file, range: options.range }),
    options,
    planState,
    apiKeyStatus,
    isConsentRequired,
    isConsentChecked
  });
  const plan = planState.status === PLAN_STATUS.READY ? planState.plan : null;
  const isViewingResult = readiness.action === TRANSLATE_ACTION.VIEW_RESULT;
  const values = summaryValuesOf({ planState, options });
  const rows: SummaryRow[] = [
    { label: TRANSLATE_OPTIONS_TEXT.SUMMARY_PAGES, value: values.pages },
    {
      label: TRANSLATE_OPTIONS_TEXT.SUMMARY_PARAGRAPHS,
      value: values.paragraphs
    },
    { label: TRANSLATE_OPTIONS_TEXT.SUMMARY_INPUT, value: values.inputTokens },
    {
      label: TRANSLATE_OPTIONS_TEXT.SUMMARY_OUTPUT,
      value: values.outputTokens
    },
    { label: TRANSLATE_OPTIONS_TEXT.SUMMARY_COST, value: values.cost }
  ];

  const handleStart = () => {
    if (readiness.action === TRANSLATE_ACTION.OPEN_API_KEY) {
      onRequestApiKey();
      return;
    }
    // 시작·결과 보기는 지금 옵션으로 받은 계획이 있을 때만 된다(`translateReadinessOf`).
    if (plan === null) return;
    switch (readiness.action) {
      case TRANSLATE_ACTION.VIEW_RESULT:
        void startTranslation({ options, plan, isConsentGiven: false });
        return;
      case TRANSLATE_ACTION.START:
        void startTranslation({
          options,
          plan,
          isConsentGiven: isConsentRequired
        });
    }
  };

  const renderButtonLabel = () => {
    if (isViewingResult) return TRANSLATE_OPTIONS_TEXT.VIEW_RESULT;
    return (
      <>
        <Play size={PLAY_ICON_SIZE} fill="currentColor" aria-hidden="true" />
        {TRANSLATE_OPTIONS_TEXT.START}
      </>
    );
  };

  return (
    <aside
      aria-labelledby={titleId}
      className="bg-card border-border sticky top-0 flex flex-col gap-4 rounded-xl border p-5"
    >
      <h2 id={titleId} className="text-[15px]/5.5 font-semibold">
        {TRANSLATE_OPTIONS_TEXT.SUMMARY_TITLE}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[13px]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-mono">{row.value}</dd>
          </div>
        ))}
      </dl>
      {plan !== null && <ResumeNotice plan={plan} />}
      <p className="text-muted-foreground text-xs/4.25">
        {TRANSLATE_OPTIONS_TEXT.BILLING_NOTE}
        {plan !== null &&
          ` ${translateOptionsText.pricingDate(plan.pricingDate)}`}
      </p>
      <div aria-hidden="true" className="bg-border h-px" />
      {apiKeyRow}
      {isConsentRequired && !isViewingResult && (
        <label className="bg-card-inset border-border flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-[13px]/4.75">
          <Checkbox
            checked={isConsentChecked}
            onCheckedChange={(checked) => setConsentChecked(checked === true)}
            className="mt-0.5"
          />
          <span>{TRANSLATE_OPTIONS_TEXT.CONSENT}</span>
        </label>
      )}
      {!isConsentRequired && (
        <p className="text-muted-foreground text-xs/4.25">
          {TRANSLATE_OPTIONS_TEXT.CONSENT_OFF} ·{" "}
          <button
            type="button"
            onClick={onOpenTranslateSettings}
            aria-label={TRANSLATE_OPTIONS_TEXT.OPEN_SETTINGS_LABEL}
            className="text-primary focus-visible:ring-ring rounded-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
          >
            {TRANSLATE_OPTIONS_TEXT.OPEN_SETTINGS}
          </button>
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button
          disabled={readiness.action === TRANSLATE_ACTION.BLOCKED}
          aria-describedby={readiness.reason === null ? undefined : reasonId}
          onClick={handleStart}
          className="h-11 gap-2 rounded-md text-[15px] font-semibold"
        >
          {renderButtonLabel()}
        </Button>
        {readiness.reason !== null && (
          <p
            id={reasonId}
            className="text-muted-foreground text-center text-xs/4.25"
          >
            {readiness.reason}
          </p>
        )}
      </div>
    </aside>
  );
}
