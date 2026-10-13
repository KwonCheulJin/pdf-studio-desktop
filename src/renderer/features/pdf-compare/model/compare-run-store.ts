import { create } from "zustand";
import type {
  CompareProgress,
  CompareRequest,
  CompareStage
} from "@/renderer/shared/api/bindings";
import type { CompareSlot } from "../config/compare-files";

/** 진행 화면에 보일 문서 이름. 실행 중에 슬롯이 바뀌어도 시작할 때의 이름을 보인다. */
export type CompareRunNames = Record<CompareSlot, string>;

interface CompareRunState {
  /** 진행 중인 작업 ID(`cancelJob`에 넘긴다). 진행 중이 아니면 `null` */
  jobId: string | null;
  /** 보낸 요청(진행 화면이 옵션을 보고 세부 문구를 만든다) */
  request: CompareRequest | null;
  names: CompareRunNames | null;
  /** 마지막으로 받은 진행률 */
  progress: CompareProgress | null;
  /** 단계마다 마지막으로 받은 진행률. 지난 단계의 개수·캐시 여부를 보인다. */
  stageProgress: Partial<Record<CompareStage, CompareProgress>>;
  /** 시작 시각(`Date.now()`, 경과 시간) */
  startedAt: number | null;
  isCancelRequested: boolean;
}

interface StartRunParams {
  request: CompareRequest;
  names: CompareRunNames;
  startedAt: number;
}

interface UpdateProgressParams {
  jobId: string;
  progress: CompareProgress;
}

interface CompareRunActions {
  startRun: (params: StartRunParams) => void;
  /** 진행 중인 작업의 진행률만 받는다(끝났거나 다른 작업의 늦은 보고는 버린다). */
  updateProgress: (params: UpdateProgressParams) => void;
  requestCancel: () => void;
  /** 성공·취소·실패 뒤 초기 상태로 */
  endRun: () => void;
}

const INITIAL_COMPARE_RUN_STATE: CompareRunState = {
  jobId: null,
  request: null,
  names: null,
  progress: null,
  stageProgress: {},
  startedAt: null,
  isCancelRequested: false
};

/** 비교 한 번의 실행 상태(진행률·취소). 화면을 바꿔도 남아 다른 모드의 상태바가 % 를 보인다. */
export const useCompareRunStore = create<CompareRunState & CompareRunActions>(
  (set) => ({
    ...INITIAL_COMPARE_RUN_STATE,
    startRun: ({ request, names, startedAt }) =>
      set({
        ...INITIAL_COMPARE_RUN_STATE,
        jobId: request.jobId,
        request,
        names,
        startedAt
      }),
    updateProgress: ({ jobId, progress }) =>
      set((state) =>
        state.jobId === jobId
          ? {
              progress,
              stageProgress: {
                ...state.stageProgress,
                [progress.stage]: progress
              }
            }
          : state
      ),
    requestCancel: () => set({ isCancelRequested: true }),
    endRun: () => set(INITIAL_COMPARE_RUN_STATE)
  })
);

interface CompareRunStatus {
  isRunning: boolean;
  /** 진행 중이 아니거나 아직 진행률을 받지 않았으면 0 */
  overallPercent: number;
}

const NO_PROGRESS_PERCENT = 0;

/** 상태바·툴바용 요약 */
export function useCompareRunStatus(): CompareRunStatus {
  const isRunning = useCompareRunStore((state) => state.jobId !== null);
  const overallPercent = useCompareRunStore(
    (state) => state.progress?.overallPercent ?? NO_PROGRESS_PERCENT
  );
  return { isRunning, overallPercent };
}
