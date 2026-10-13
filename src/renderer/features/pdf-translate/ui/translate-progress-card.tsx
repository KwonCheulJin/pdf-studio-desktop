import { useId } from "react";
import { Check, LoaderCircle } from "lucide-react";
import {
  SOURCE_LANGUAGE_LABEL,
  TARGET_LANGUAGE_LABEL,
  TRANSLATE_MODEL_INFO
} from "@/renderer/entities/translation";
import type { TranslateStage } from "@/renderer/shared/api/bindings";
import {
  formatElapsed,
  useElapsedSeconds
} from "@/renderer/shared/lib/elapsed-time";
import { cn } from "@/renderer/shared/lib/utils";
import { Button, ProgressBar } from "@/renderer/shared/ui";
import {
  STAGE_STATE,
  TRANSLATE_PROGRESS_TEXT,
  TRANSLATE_STAGE_LABEL,
  TRANSLATE_STAGE_ORDER,
  translateProgressText,
  type StageState
} from "../config/translate-progress";
import {
  stageDetailOf,
  stagePercentOf,
  stageStateOf
} from "../lib/translate-stage-detail";
import {
  useTranslateRun,
  type TranslateRun
} from "../model/translate-session-store";
import { useTranslateExecution } from "../model/use-translate-execution";

const PERCENT_MIN = 0;
/** 진행률을 받기 전 사용량 */
const NO_TOKENS = 0;
const STAGE_ICON_SIZE = 14;
const STAGE_ICON_STROKE = 3;
/** 작업 행 번호는 1부터(시안 12) */
const FIRST_STAGE_NUMBER = 1;

/** 상태 점(26px): 완료 ✓(success), 진행 중 회전(primary), 대기 번호. 비교 진행 화면(시안 9)과 같은 모양 */
const STAGE_DOT_CLASS: Record<StageState, string> = {
  [STAGE_STATE.DONE]: "bg-success text-success-foreground",
  [STAGE_STATE.ACTIVE]: "border-primary text-primary border",
  [STAGE_STATE.PENDING]: "border-input text-muted-foreground border"
};

interface StageDotProps {
  state: StageState;
  number: number;
}

function StageDot({ state, number }: StageDotProps) {
  const renderMark = () => {
    switch (state) {
      case STAGE_STATE.DONE:
        return (
          <Check
            size={STAGE_ICON_SIZE}
            strokeWidth={STAGE_ICON_STROKE}
            aria-hidden="true"
          />
        );
      case STAGE_STATE.ACTIVE:
        return (
          <LoaderCircle
            size={STAGE_ICON_SIZE}
            strokeWidth={STAGE_ICON_STROKE}
            aria-hidden="true"
            className="motion-safe:animate-spin"
          />
        );
      default:
        return <span className="font-mono text-[11px]">{number}</span>;
    }
  };
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6.5 shrink-0 items-center justify-center rounded-full",
        STAGE_DOT_CLASS[state]
      )}
    >
      {renderMark()}
    </span>
  );
}

interface StageRowProps {
  run: TranslateRun;
  stage: TranslateStage;
  number: number;
}

/** 작업 행(시안 12): 상태 점 · 이름 · 세부 · 단계 % · 얇은 막대(완료 success, 진행 primary) */
function StageRow({ run, stage, number }: StageRowProps) {
  const { progress } = run;
  const state = stageStateOf({ stage, progress });
  const percent = stagePercentOf({ stage, progress });
  const isPending = state === STAGE_STATE.PENDING;
  const label = TRANSLATE_STAGE_LABEL[stage];

  return (
    <li className="border-border flex items-center gap-3.5 border-b py-3.5 last:border-b-0">
      <StageDot state={state} number={number} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-2.5">
          <span
            className={
              isPending
                ? "text-muted-foreground"
                : "text-foreground font-semibold"
            }
          >
            {label}
          </span>
          <span className="text-muted-foreground text-xs/4.25">
            {stageDetailOf({
              stage,
              progress,
              reported: run.stageProgress[stage]
            })}
          </span>
        </span>
        <ProgressBar
          label={`${label} 진행률`}
          percent={percent}
          className="h-1.5"
          fillClassName={
            state === STAGE_STATE.DONE ? "bg-success" : "bg-primary"
          }
        />
      </div>
      <span
        className={cn(
          "w-14 shrink-0 text-right font-mono text-sm font-medium",
          isPending ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {percent}%
      </span>
    </li>
  );
}

interface RunPartProps {
  run: TranslateRun;
}

/** 사용량 상자(시안 12): 이번 실행에서 받은 입력·출력 토큰과 계획의 예상 합계 */
function UsageBox({ run }: RunPartProps) {
  const usage = run.progress?.usage;
  return (
    <div className="bg-card-inset border-border mx-7 mb-4 flex flex-wrap gap-5 rounded-md border px-3.5 py-3 text-[13px]">
      <span className="text-muted-foreground">
        {TRANSLATE_PROGRESS_TEXT.USAGE_TITLE}
      </span>
      <span>
        {TRANSLATE_PROGRESS_TEXT.USAGE_INPUT}{" "}
        <b className="font-mono font-medium">
          {translateProgressText.tokenCount(usage?.inputTokens ?? NO_TOKENS)}
        </b>{" "}
        {TRANSLATE_PROGRESS_TEXT.TOKENS}
      </span>
      <span>
        {TRANSLATE_PROGRESS_TEXT.USAGE_OUTPUT}{" "}
        <b className="font-mono font-medium">
          {translateProgressText.tokenCount(usage?.outputTokens ?? NO_TOKENS)}
        </b>{" "}
        {TRANSLATE_PROGRESS_TEXT.TOKENS}
      </span>
      <span className="text-muted-foreground">
        {translateProgressText.estimatedTotal(run.info.estimatedTokens)}
      </span>
    </div>
  );
}

/** 머리 줄(시안 12): `<파일 이름> · 중국어 → 한국어 · Sonnet 5.5` */
function RunHeading({ run }: RunPartProps) {
  const { sourceLanguage } = run.info;
  const languages =
    sourceLanguage === null
      ? null
      : translateProgressText.languages({
          source: SOURCE_LANGUAGE_LABEL[sourceLanguage],
          target: TARGET_LANGUAGE_LABEL
        });
  return (
    <p className="min-w-0 break-words">
      {run.info.fileName}
      <span className="text-muted-foreground">
        {translateProgressText.runHeadingSuffix({
          languages,
          modelName: TRANSLATE_MODEL_INFO[run.request.options.model].name
        })}
      </span>
    </p>
  );
}

/**
 * 번역 진행 카드(계획서 P6-10, 시안 12): 문서·언어·모델, 전체 %·막대·경과 시간, 3개 작업 행, 사용량, 취소.
 * 비교 진행 카드(시안 9)와 같은 틀(너비 762px, 모서리 16px)이다.
 * 다른 모드로 가도 작업은 계속되고 이 카드는 돌아오면 그대로다.
 */
export function TranslateProgressCard() {
  const titleId = useId();
  const run = useTranslateRun();
  const elapsedSeconds = useElapsedSeconds(run?.startedAt ?? null);
  const { cancelTranslation } = useTranslateExecution();
  if (run === null) return null;
  const overallPercent = run.progress?.overallPercent ?? PERCENT_MIN;

  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex w-full max-w-190.5 flex-col self-start rounded-xl border"
    >
      <div className="border-border flex flex-col gap-3.5 border-b px-7 pt-6 pb-5">
        <RunHeading run={run} />
        <div className="flex items-baseline gap-3">
          <h2 id={titleId} className="text-[15px]/5.5 font-semibold">
            {TRANSLATE_PROGRESS_TEXT.OVERALL}
          </h2>
          <span className="grow" />
          <span className="text-muted-foreground font-mono text-xs">
            {TRANSLATE_PROGRESS_TEXT.ELAPSED} {formatElapsed(elapsedSeconds)}
          </span>
          <span className="font-mono text-[28px]/8 font-medium">
            {overallPercent}%
          </span>
        </div>
        <ProgressBar
          label={TRANSLATE_PROGRESS_TEXT.OVERALL}
          percent={overallPercent}
          className="h-2.5"
          fillClassName="bg-primary"
        />
      </div>

      <ol aria-label={TRANSLATE_PROGRESS_TEXT.STAGES} className="px-7 py-2">
        {TRANSLATE_STAGE_ORDER.map((stage, index) => (
          <StageRow
            key={stage}
            run={run}
            stage={stage}
            number={index + FIRST_STAGE_NUMBER}
          />
        ))}
      </ol>

      <UsageBox run={run} />

      <div className="border-border flex flex-wrap items-center gap-3 border-t px-7 pt-4 pb-5">
        <span className="text-muted-foreground min-w-0 flex-1 text-xs/4.25">
          {TRANSLATE_PROGRESS_TEXT.CANCEL_NOTE}
        </span>
        <Button
          variant="outline"
          disabled={run.isCancelRequested}
          onClick={() => void cancelTranslation()}
          className="bg-card h-10.5 rounded-md px-4.5 font-normal"
        >
          {run.isCancelRequested
            ? TRANSLATE_PROGRESS_TEXT.CANCELLING
            : TRANSLATE_PROGRESS_TEXT.CANCEL}
        </Button>
      </div>
    </section>
  );
}
