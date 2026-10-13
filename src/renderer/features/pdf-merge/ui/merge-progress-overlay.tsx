import { useId } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import {
  MERGE_STATUS,
  useMergeFiles,
  useMergeStatus
} from "@/renderer/entities/merge-plan";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import { cn } from "@/renderer/shared/lib/utils";
import { Button } from "@/renderer/shared/ui";
import { getMergeFailureResolution } from "../config/merge-failure-resolution";
import {
  MERGE_STAGE_LABEL,
  MERGE_STAGE_NOT_STARTED_LABEL,
  MERGE_STAGE_ORDER,
  STAGE_STATE
} from "../config/merge-stage";
import {
  formatStageCount,
  stageDetailOf,
  stagePercentOf,
  stageStateOf
} from "../lib/merge-stage-detail";
import { useMergeExecution } from "../model/use-merge-execution";
import { useMergeRunStore, type MergeFailure } from "../model/merge-run-store";
import { useMergeRunControls } from "../model/use-merge-run-controls";

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;
const ESCAPE_KEY = "Escape";

/** 진행·실패 대화상자 공통 틀(시안 7·8: 너비 520px, 패딩 24/28px, 모서리 16px) */
const PANEL_CLASS =
  "bg-card flex w-full max-w-130 flex-col rounded-xl px-7 py-6 shadow-xl";
/** 대화상자 버튼(시안 7·8: 높이 36px, 모서리 8px) */
const DIALOG_BUTTON_CLASS = "h-9 rounded-md px-3.5 font-normal";

interface ProgressBarProps {
  label: string;
  percent: number;
  className: string;
  fillClassName: string;
}

function ProgressBar({
  label,
  percent,
  className,
  fillClassName
}: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={PERCENT_MIN}
      aria-valuemax={PERCENT_MAX}
      aria-valuenow={percent}
      className={cn(
        "bg-secondary w-full overflow-hidden rounded-full",
        className
      )}
    >
      <div
        className={cn("h-full rounded-full transition-all", fillClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** 시안 7: 전체 %, 단계별 이름·세부·%·막대, 취소 */
function MergeProgressPanel() {
  const titleId = useId();
  const progress = useMergeRunStore((state) => state.progress);
  const sources = useMergeRunStore((state) => state.sources);
  const isCancelRequested = useMergeRunStore(
    (state) => state.isCancelRequested
  );
  const { cancelMerge } = useMergeRunControls();
  const overallPercent = progress?.overallPercent ?? PERCENT_MIN;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      className={cn(PANEL_CLASS, "gap-4.5")}
    >
      <div className="flex items-baseline gap-3">
        <h2 id={titleId} className="text-foreground text-lg/6.5 font-semibold">
          병합하는 중
        </h2>
        <span className="text-foreground ml-auto font-mono text-[28px]/8 font-medium">
          {overallPercent}%
        </span>
      </div>
      <ProgressBar
        label="전체 진행률"
        percent={overallPercent}
        className="h-2.5"
        fillClassName="bg-primary"
      />
      <ol aria-label="작업별 진행" className="flex flex-col gap-3">
        {MERGE_STAGE_ORDER.map((stage) => {
          const percent = stagePercentOf({ stage, progress });
          const state = stageStateOf({ stage, progress });
          const isPending = state === STAGE_STATE.PENDING;
          const label = MERGE_STAGE_LABEL[stage];
          return (
            <li key={stage} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-3">
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
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
                    {stageDetailOf({ stage, progress, sources })}
                  </span>
                </span>
                <span
                  className={cn(
                    "w-12 text-right font-mono text-[13px] font-medium",
                    isPending ? "text-muted-foreground" : "text-foreground"
                  )}
                >
                  {percent}%
                </span>
              </div>
              <ProgressBar
                label={`${label} 진행률`}
                percent={percent}
                className="h-1.5"
                fillClassName={
                  percent === PERCENT_MAX ? "bg-success" : "bg-primary"
                }
              />
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-xs/4.25">
          취소하면 만들던 파일은 지워요. 원본은 그대로예요.
        </span>
        <Button
          variant="outline"
          className={cn(DIALOG_BUTTON_CLASS, "bg-card ml-auto px-4")}
          disabled={isCancelRequested}
          onClick={cancelMerge}
        >
          {isCancelRequested ? "취소하는 중..." : "취소"}
        </Button>
      </div>
    </section>
  );
}

interface MergeFailurePanelProps {
  failure: MergeFailure;
}

/** 시안 8: 원인·해결 방법, 멈춘 곳·오류 코드와 이 파일 빼기 / 닫기 / 다시 시도 */
function MergeFailurePanel({ failure }: MergeFailurePanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const files = useMergeFiles();
  const progress = useMergeRunStore((state) => state.progress);
  const { retryMerge } = useMergeExecution();
  const { closeFailure, removeFailedFile } = useMergeRunControls();

  const failedFile = failure.sourcePath
    ? files.find((file) => file.path === failure.sourcePath)
    : undefined;
  const stageLabel = failure.stage
    ? MERGE_STAGE_LABEL[failure.stage]
    : MERGE_STAGE_NOT_STARTED_LABEL;
  // 멈춘 단계의 마지막 개수("12 / 43쪽"). 개수를 세지 않는 단계(저장)는 단계 이름만
  const stoppedCount =
    failure.stage !== null && progress?.stage === failure.stage
      ? formatStageCount({
          stage: failure.stage,
          done: progress.done,
          total: progress.total
        })
      : null;
  const stoppedAt =
    stoppedCount === null ? stageLabel : `${stageLabel} · ${stoppedCount}`;
  const resolution = getMergeFailureResolution(failure.code);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === ESCAPE_KEY) {
      event.stopPropagation();
      closeFailure();
    }
  };

  return (
    <section
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}
      className={cn(PANEL_CLASS, "gap-4")}
    >
      <div className="flex items-start gap-3.5">
        <span className="bg-destructive-subtle text-destructive flex size-9 shrink-0 items-center justify-center rounded-full">
          <CircleAlert size={18} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={titleId}
            className="text-foreground text-lg/6.5 font-semibold"
          >
            병합하지 못했어요
          </h2>
          <p
            id={descriptionId}
            className="text-muted-foreground text-sm/5.25 break-words"
          >
            {failedFile && (
              <strong className="text-foreground font-medium">
                {failedFile.name}
              </strong>
            )}
            {failedFile && ": "}
            {getErrorMessage(failure.code)}
            {resolution && ` ${resolution}`}
          </p>
        </div>
      </div>
      <dl className="bg-muted text-muted-foreground flex items-center gap-2 rounded-md px-3 py-2.5 text-xs/4.25">
        <div className="flex min-w-0 gap-1">
          <dt>멈춘 곳:</dt>
          <dd>{stoppedAt}</dd>
        </div>
        <div className="ml-auto flex shrink-0">
          <dt className="sr-only">오류 코드</dt>
          <dd className="font-mono">{failure.code}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        {failedFile && (
          <Button
            variant="ghost"
            className={DIALOG_BUTTON_CLASS}
            onClick={removeFailedFile}
          >
            이 파일 빼기
          </Button>
        )}
        <Button
          variant="outline"
          className={cn(DIALOG_BUTTON_CLASS, "bg-card")}
          onClick={closeFailure}
        >
          닫기
        </Button>
        {/* 실패가 보이면 키보드 포커스를 대화상자 안으로 옮긴다. */}
        <Button
          autoFocus
          className="h-9 rounded-md px-4 font-medium"
          onClick={retryMerge}
        >
          다시 시도
        </Button>
      </div>
    </section>
  );
}

/** 병합 진행 오버레이. 실패하면 같은 자리에 실패 내용을 보인다. */
export function MergeProgressOverlay() {
  const status = useMergeStatus();
  const failure = useMergeRunStore((state) => state.failure);

  let panel: ReactNode = null;
  if (status === MERGE_STATUS.MERGING) {
    panel = <MergeProgressPanel />;
  } else if (status === MERGE_STATUS.ERROR && failure) {
    panel = <MergeFailurePanel failure={failure} />;
  }
  if (panel === null) return null;

  return (
    <div className="bg-scrim fixed inset-0 z-50 flex items-center justify-center p-6">
      {panel}
    </div>
  );
}
