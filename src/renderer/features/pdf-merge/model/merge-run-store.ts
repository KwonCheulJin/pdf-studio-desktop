import { create } from "zustand";
import type {
  MergeProgress,
  MergeSource,
  MergeStage
} from "@/renderer/shared/api/bindings";
import type { PlatformErrorCode } from "@/renderer/shared/platform";

/** 병합 실패. 화면은 `code`로 문구를 찾는다. */
export interface MergeFailure {
  code: PlatformErrorCode;
  /** 멈춘 단계(마지막으로 진행률을 받은 단계). 진행률 전에 실패했으면 `null` */
  stage: MergeStage | null;
  /** 실패를 일으킨 입력 파일(`AppError.path`). 모르면 `null` */
  sourcePath: string | null;
}

interface MergeRunState {
  /** 진행 중인 작업 ID(`cancelJob`에 넘긴다). 진행 중이 아니면 `null` */
  jobId: string | null;
  /** 마지막으로 보낸 병합 소스. "다시 시도"가 같은 요청을 다시 보낸다. */
  sources: MergeSource[];
  progress: MergeProgress | null;
  isCancelRequested: boolean;
  failure: MergeFailure | null;
}

interface StartRunParams {
  jobId: string;
  sources: MergeSource[];
}

interface UpdateProgressParams {
  jobId: string;
  progress: MergeProgress;
}

interface MergeRunActions {
  startRun: (params: StartRunParams) => void;
  /** 진행 중인 작업의 진행률만 받는다(끝났거나 다른 작업의 늦은 보고는 버린다). */
  updateProgress: (params: UpdateProgressParams) => void;
  requestCancel: () => void;
  failRun: (failure: MergeFailure) => void;
  /** 성공·취소·실패 닫기 뒤 초기 상태로 */
  endRun: () => void;
}

const INITIAL_MERGE_RUN_STATE: MergeRunState = {
  jobId: null,
  sources: [],
  progress: null,
  isCancelRequested: false,
  failure: null
};

/** 전체 병합 한 번의 실행 상태(진행률·취소·실패). 화면 상태(`MERGE_STATUS`)는 merge-store가 갖는다. */
export const useMergeRunStore = create<MergeRunState & MergeRunActions>(
  (set) => ({
    ...INITIAL_MERGE_RUN_STATE,
    startRun: ({ jobId, sources }) =>
      set({ ...INITIAL_MERGE_RUN_STATE, jobId, sources }),
    updateProgress: ({ jobId, progress }) =>
      set((state) => (state.jobId === jobId ? { progress } : state)),
    requestCancel: () => set({ isCancelRequested: true }),
    failRun: (failure) => set({ jobId: null, failure }),
    endRun: () => set(INITIAL_MERGE_RUN_STATE)
  })
);
