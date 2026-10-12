import { useId } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import type { MergeProgress, MergeStage } from "@/renderer/shared/api/bindings";
import {
  MERGE_STATUS,
  useMergeFiles,
  useMergeStatus
} from "@/renderer/entities/merge-plan";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import { Button } from "@/renderer/shared/ui";
import {
  MERGE_STAGE_LABEL,
  MERGE_STAGE_NOT_STARTED_LABEL,
  MERGE_STAGE_ORDER
} from "../config/merge-stage";
import { useMergeExecution } from "../model/use-merge-execution";
import { useMergeRunStore, type MergeFailure } from "../model/merge-run-store";
import { useMergeRunControls } from "../model/use-merge-run-controls";

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;
const ESCAPE_KEY = "Escape";

interface StagePercentParams {
  stage: MergeStage;
  progress: MergeProgress | null;
}

/** 지난 단계는 100, 지금 단계는 보고된 값, 아직 오지 않은 단계는 0 */
function stagePercentOf({ stage, progress }: StagePercentParams): number {
  if (progress === null) return PERCENT_MIN;
  const stageIndex = MERGE_STAGE_ORDER.indexOf(stage);
  const currentIndex = MERGE_STAGE_ORDER.indexOf(progress.stage);
  if (stageIndex < currentIndex) return PERCENT_MAX;
  if (stageIndex > currentIndex) return PERCENT_MIN;
  return progress.stagePercent;
}

interface ProgressBarProps {
  label: string;
  percent: number;
}

function ProgressBar({ label, percent }: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={PERCENT_MIN}
      aria-valuemax={PERCENT_MAX}
      aria-valuenow={percent}
      className="bg-muted h-2 w-full overflow-hidden rounded-full"
    >
      <div
        className="bg-primary h-full rounded-full transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** 시안 7: 전체 %, 단계별 %·막대, 취소 */
function MergeProgressPanel() {
  const progress = useMergeRunStore((state) => state.progress);
  const isCancelRequested = useMergeRunStore(
    (state) => state.isCancelRequested
  );
  const { cancelMerge } = useMergeRunControls();
  const overallPercent = progress?.overallPercent ?? PERCENT_MIN;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-card flex w-96 flex-col gap-5 rounded-2xl px-8 py-7 shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
        <p className="text-foreground text-base font-semibold">
          PDF 병합 중...
        </p>
        <span className="text-foreground ml-auto text-base font-semibold">
          {overallPercent}%
        </span>
      </div>
      <ProgressBar label="전체 진행률" percent={overallPercent} />
      <ul className="flex flex-col gap-3">
        {MERGE_STAGE_ORDER.map((stage) => {
          const percent = stagePercentOf({ stage, progress });
          const label = MERGE_STAGE_LABEL[stage];
          return (
            <li key={stage} className="flex flex-col gap-1">
              <div className="text-muted-foreground flex justify-between text-xs">
                <span>{label}</span>
                <span>{percent}%</span>
              </div>
              <ProgressBar label={`${label} 진행률`} percent={percent} />
            </li>
          );
        })}
      </ul>
      <Button
        variant="outline"
        className="self-end"
        disabled={isCancelRequested}
        onClick={cancelMerge}
      >
        {isCancelRequested ? "취소하는 중..." : "취소"}
      </Button>
    </div>
  );
}

interface MergeFailurePanelProps {
  failure: MergeFailure;
}

/** 시안 8: 원인·멈춘 단계·오류 코드와 다시 시도 / 이 파일 빼기 / 닫기 */
function MergeFailurePanel({ failure }: MergeFailurePanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const files = useMergeFiles();
  const { retryMerge } = useMergeExecution();
  const { closeFailure, removeFailedFile } = useMergeRunControls();

  const failedFile = failure.sourcePath
    ? files.find((file) => file.path === failure.sourcePath)
    : undefined;
  const stageLabel = failure.stage
    ? MERGE_STAGE_LABEL[failure.stage]
    : MERGE_STAGE_NOT_STARTED_LABEL;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ESCAPE_KEY) {
      event.stopPropagation();
      closeFailure();
    }
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}
      className="bg-card flex w-96 flex-col gap-5 rounded-2xl px-8 py-7 shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <CircleAlert className="text-destructive h-6 w-6 shrink-0" />
        <h2 id={titleId} className="text-foreground text-base font-semibold">
          병합하지 못했습니다
        </h2>
      </div>
      <p id={descriptionId} className="text-foreground text-sm">
        {getErrorMessage(failure.code)}
      </p>
      <dl className="flex flex-col gap-1 text-xs">
        <div className="flex gap-3">
          <dt className="text-muted-foreground w-16 shrink-0">멈춘 단계</dt>
          <dd className="text-foreground">{stageLabel}</dd>
        </div>
        {failedFile && (
          <div className="flex gap-3">
            <dt className="text-muted-foreground w-16 shrink-0">문제 파일</dt>
            <dd className="text-foreground truncate">{failedFile.name}</dd>
          </div>
        )}
        <div className="flex gap-3">
          <dt className="text-muted-foreground w-16 shrink-0">오류 코드</dt>
          <dd className="text-foreground font-mono">{failure.code}</dd>
        </div>
      </dl>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={closeFailure}>
          닫기
        </Button>
        {failedFile && (
          <Button variant="outline" onClick={removeFailedFile}>
            이 파일 빼기
          </Button>
        )}
        {/* 실패가 보이면 키보드 포커스를 대화상자 안으로 옮긴다. */}
        <Button autoFocus onClick={retryMerge}>
          다시 시도
        </Button>
      </div>
    </div>
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
    <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      {panel}
    </div>
  );
}
