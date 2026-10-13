import { useId } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import type { CompareStage } from "@/renderer/shared/api/bindings";
import { cn } from "@/renderer/shared/lib/utils";
import { Button, ProgressBar } from "@/renderer/shared/ui";
import {
  COMPARE_SLOT_LABEL,
  COMPARE_SLOTS,
  type CompareSlot
} from "../config/compare-files";
import {
  COMPARE_PROGRESS_TEXT,
  COMPARE_STAGE_LABEL,
  COMPARE_STAGE_ORDER,
  STAGE_STATE,
  type StageState
} from "../config/compare-stage";
import {
  formatElapsed,
  stageDetailOf,
  stagePercentOf,
  stageStateOf
} from "../lib/compare-stage-detail";
import { useCompareRunStore } from "../model/compare-run-store";
import { useCompareExecution } from "../model/use-compare-execution";
import { useElapsedSeconds } from "../model/use-elapsed-seconds";

const PERCENT_MIN = 0;
const STAGE_ICON_SIZE = 14;
const STAGE_ICON_STROKE = 3;
const ARROW_ICON_SIZE = 14;
/** 작업 행 번호는 1부터(시안 9) */
const FIRST_STAGE_NUMBER = 1;

/** 상태 점(26px): 완료 ✓(success), 진행 중 회전(primary), 대기 번호 */
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
  stage: CompareStage;
  number: number;
}

/** 작업 행(시안 9): 상태 점 · 이름 · 세부 · 작업별 % · 얇은 막대(완료 success, 진행 primary) */
function StageRow({ stage, number }: StageRowProps) {
  const progress = useCompareRunStore((state) => state.progress);
  const reported = useCompareRunStore((state) => state.stageProgress[stage]);
  const options = useCompareRunStore((state) => state.request?.options ?? null);
  const state = stageStateOf({ stage, progress });
  const percent = stagePercentOf({ stage, progress });
  const isPending = state === STAGE_STATE.PENDING;
  const label = COMPARE_STAGE_LABEL[stage];

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
            {stageDetailOf({ stage, progress, reported, options })}
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

interface FileNameProps {
  slot: CompareSlot;
  name: string;
}

function FileName({ slot, name }: FileNameProps) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="bg-foreground text-background inline-flex size-4.5 shrink-0 items-center justify-center rounded-xs text-[11px] font-semibold">
        {COMPARE_SLOT_LABEL[slot].badge}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * 비교 진행 카드(계획서 P3-3a, 시안 9): A → B 이름, 전체 %·막대·경과 시간, 6개 작업 행, 취소.
 * 너비·버튼 높이는 시안이 그려지는 값(content-box 760px·40px + 테두리)이다.
 * 다른 모드로 가도 작업은 계속되고 이 카드는 돌아오면 그대로다.
 */
export function CompareProgressCard() {
  const titleId = useId();
  const names = useCompareRunStore((state) => state.names);
  const overallPercent = useCompareRunStore(
    (state) => state.progress?.overallPercent ?? PERCENT_MIN
  );
  const startedAt = useCompareRunStore((state) => state.startedAt);
  const isCancelRequested = useCompareRunStore(
    (state) => state.isCancelRequested
  );
  const elapsedSeconds = useElapsedSeconds(startedAt);
  const { cancelCompare } = useCompareExecution();

  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex w-full max-w-190.5 flex-col self-start rounded-xl border"
    >
      <div className="border-border flex flex-col gap-3.5 border-b px-7 pt-6 pb-5">
        {names && (
          <p className="flex min-w-0 flex-wrap items-center gap-2">
            {COMPARE_SLOTS.map((slot, index) => (
              <span key={slot} className="flex min-w-0 items-center gap-2">
                {index > 0 && (
                  <ArrowRight
                    size={ARROW_ICON_SIZE}
                    aria-hidden="true"
                    className="text-muted-foreground shrink-0"
                  />
                )}
                <FileName slot={slot} name={names[slot]} />
              </span>
            ))}
          </p>
        )}
        <div className="flex items-baseline gap-3">
          <h2 id={titleId} className="text-[15px]/5.5 font-semibold">
            {COMPARE_PROGRESS_TEXT.OVERALL}
          </h2>
          <span className="grow" />
          <span className="text-muted-foreground font-mono text-xs">
            {COMPARE_PROGRESS_TEXT.ELAPSED} {formatElapsed(elapsedSeconds)}
          </span>
          <span className="font-mono text-[28px]/8 font-medium">
            {overallPercent}%
          </span>
        </div>
        <ProgressBar
          label={COMPARE_PROGRESS_TEXT.OVERALL}
          percent={overallPercent}
          className="h-2.5"
          fillClassName="bg-primary"
        />
      </div>

      <ol aria-label={COMPARE_PROGRESS_TEXT.STAGES} className="px-7 py-2">
        {COMPARE_STAGE_ORDER.map((stage, index) => (
          <StageRow
            key={stage}
            stage={stage}
            number={index + FIRST_STAGE_NUMBER}
          />
        ))}
      </ol>

      <div className="border-border flex flex-wrap items-center gap-3 border-t px-7 pt-4 pb-5">
        <span className="text-muted-foreground min-w-0 flex-1 text-xs/4.25">
          {COMPARE_PROGRESS_TEXT.CANCEL_NOTE}
        </span>
        <Button
          variant="outline"
          disabled={isCancelRequested}
          onClick={() => void cancelCompare()}
          className="bg-card h-10.5 rounded-md px-4.5 font-normal"
        >
          {isCancelRequested
            ? COMPARE_PROGRESS_TEXT.CANCELLING
            : COMPARE_PROGRESS_TEXT.CANCEL}
        </Button>
      </div>
    </section>
  );
}
