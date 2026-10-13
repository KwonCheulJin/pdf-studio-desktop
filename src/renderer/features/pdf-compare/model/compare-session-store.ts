import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  EMPTY_CHANGE_FILTER,
  type ChangeFilter,
  type ChangeKind
} from "@/renderer/entities/comparison";
import type {
  CompareOptions,
  CompareResult
} from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";
import {
  COMPARE_SLOT,
  COMPARE_SLOTS,
  type CompareSlot
} from "../config/compare-files";
import {
  DEFAULT_COMPARE_OPTIONS,
  RANGE_OPTION_KEY,
  type LineExclusion
} from "../config/compare-options";
import {
  COMPARE_VIEW_MODE,
  type CompareViewMode
} from "../config/compare-result";

/** 비교할 문서 하나(`openFiles`로 연 PDF) */
export interface CompareFile {
  /** 비교·표시에 쓸 PDF 경로. 다이얼로그·드롭으로 받아 허용 경로 목록에 들어 있다(D13). */
  path: string;
  /** 화면에 보일 이름(확장자 포함) */
  name: string;
  sizeBytes: number;
  pageCount: number;
}

/** 끝난 비교 한 번. 결과와 함께 실행할 때의 두 문서·옵션·걸린 시간을 둔다. */
export interface CompletedComparison {
  /** 그 비교의 작업 ID. 결과 하나를 가리키는 키로 쓴다(화면 상태를 결과마다 새로 시작). */
  jobId: string;
  result: CompareResult;
  files: Record<CompareSlot, CompareFile>;
  options: CompareOptions;
  elapsedMs: number;
}

/** 실행 중이 아닐 때 비교 화면이 보이는 곳 */
export const COMPARE_VIEW = {
  OPTIONS: "options",
  RESULT: "result"
} as const;

export type CompareView = ValueOf<typeof COMPARE_VIEW>;

/** 결과 화면의 보는 상태(고른 변경·칩 필터·보기 방식) */
interface ResultViewState {
  activeChangeId: string | null;
  /** 고른 변경으로 스크롤하라는 요청 번호. 고를 때마다 1씩 늘린다(같은 변경을 다시 골라도). */
  revealCount: number;
  filter: ChangeFilter;
  viewMode: CompareViewMode;
}

interface CompareSessionState
  extends Record<CompareSlot, CompareFile | null>, ResultViewState {
  /** Rust로 보낼 옵션(쪽 범위·줄 제외·대소문자) */
  options: CompareOptions;
  /** 비교 대상 "글자"를 켰는가. 지금 비교할 수 있는 대상이 글자뿐이라 끄면 실행할 수 없다. */
  isTextCompared: boolean;
  /** 마지막으로 끝난 비교. 슬롯 문서를 바꾸면 지운다. */
  completed: CompletedComparison | null;
  view: CompareView;
}

interface SetSlotFileParams {
  slot: CompareSlot;
  file: CompareFile;
}

interface SetRangeParams {
  slot: CompareSlot;
  /** 1부터 센 사용자 표기(`"1,3-5"`, 비우면 전체) */
  range: string;
}

interface SetLineExcludedParams {
  exclusion: LineExclusion;
  isExcluded: boolean;
}

interface CompareSessionActions {
  /** 슬롯에 넣는다. 이미 있으면 바꾼다. 다른 문서로 바뀌면 끝난 결과를 지운다. */
  setSlotFile: (params: SetSlotFileParams) => void;
  /** A(이전)와 B(이후)를 맞바꾼다. 한쪽이 비어 있으면 빈 자리도 함께 옮긴다. 결과를 지운다. */
  swapSlots: () => void;
  setRange: (params: SetRangeParams) => void;
  setLineExcluded: (params: SetLineExcludedParams) => void;
  setIgnoreCase: (ignoreCase: boolean) => void;
  setTextCompared: (isTextCompared: boolean) => void;
  /** 옵션을 기본값으로 */
  resetOptions: () => void;
  /** 끝난 비교를 두고 결과 화면으로. 첫 변경을 고르고 필터를 푼다. */
  showResult: (completed: CompletedComparison) => void;
  /** 옵션 화면으로(결과는 남긴다) */
  showOptions: () => void;
  /** 남아 있는 결과 화면으로("최근 결과") */
  showLastResult: () => void;
  /** 새 비교: 문서·결과·옵션을 모두 비우고 옵션 화면으로 */
  startNewCompare: () => void;
  /** 변경을 고르고 그 자리로 스크롤한다. */
  selectChange: (changeId: string) => void;
  toggleKindHidden: (kind: ChangeKind) => void;
  toggleReviewHidden: () => void;
  resetFilter: () => void;
  setViewMode: (viewMode: CompareViewMode) => void;
}

type CompareSessionStore = CompareSessionState & CompareSessionActions;

const INITIAL_RESULT_VIEW: Omit<ResultViewState, "viewMode"> = {
  activeChangeId: null,
  revealCount: 0,
  filter: EMPTY_CHANGE_FILTER
};

/**
 * 비교 세션: 비교할 두 문서(A 이전 · B 이후), 실행 전 옵션, 마지막 결과와 결과 화면의 보는 상태
 * (계획서 P3-2·P3-3·P3-4). 진행 중인 작업의 진행률은 `compare-run-store`가 갖는다. 모드를 바꿔도 남는다.
 */
export const useCompareSessionStore = create<CompareSessionStore>((set) => ({
  [COMPARE_SLOT.BEFORE]: null,
  [COMPARE_SLOT.AFTER]: null,
  options: DEFAULT_COMPARE_OPTIONS,
  isTextCompared: true,
  completed: null,
  view: COMPARE_VIEW.OPTIONS,
  ...INITIAL_RESULT_VIEW,
  viewMode: COMPARE_VIEW_MODE.SIDE_BY_SIDE,
  setSlotFile: ({ slot, file }) =>
    set((state) =>
      state[slot]?.path === file.path
        ? { [slot]: file }
        : { [slot]: file, completed: null, view: COMPARE_VIEW.OPTIONS }
    ),
  swapSlots: () =>
    set((state) => ({
      [COMPARE_SLOT.BEFORE]: state[COMPARE_SLOT.AFTER],
      [COMPARE_SLOT.AFTER]: state[COMPARE_SLOT.BEFORE],
      completed: null,
      view: COMPARE_VIEW.OPTIONS
    })),
  setRange: ({ slot, range }) =>
    set((state) => ({
      options: { ...state.options, [RANGE_OPTION_KEY[slot]]: range }
    })),
  setLineExcluded: ({ exclusion, isExcluded }) =>
    set((state) => ({
      options: { ...state.options, [exclusion]: isExcluded }
    })),
  setIgnoreCase: (ignoreCase) =>
    set((state) => ({ options: { ...state.options, ignoreCase } })),
  setTextCompared: (isTextCompared) => set({ isTextCompared }),
  resetOptions: () =>
    set({ options: DEFAULT_COMPARE_OPTIONS, isTextCompared: true }),
  showResult: (completed) =>
    set({
      completed,
      view: COMPARE_VIEW.RESULT,
      ...INITIAL_RESULT_VIEW,
      activeChangeId: completed.result.changes[0]?.id ?? null
    }),
  showOptions: () => set({ view: COMPARE_VIEW.OPTIONS }),
  showLastResult: () =>
    set((state) => (state.completed ? { view: COMPARE_VIEW.RESULT } : state)),
  startNewCompare: () =>
    set({
      [COMPARE_SLOT.BEFORE]: null,
      [COMPARE_SLOT.AFTER]: null,
      options: DEFAULT_COMPARE_OPTIONS,
      isTextCompared: true,
      completed: null,
      view: COMPARE_VIEW.OPTIONS,
      ...INITIAL_RESULT_VIEW
    }),
  selectChange: (changeId) =>
    set((state) => ({
      activeChangeId: changeId,
      revealCount: state.revealCount + 1
    })),
  toggleKindHidden: (kind) =>
    set((state) => {
      const { hiddenKinds } = state.filter;
      return {
        filter: {
          ...state.filter,
          hiddenKinds: hiddenKinds.includes(kind)
            ? hiddenKinds.filter((hidden) => hidden !== kind)
            : [...hiddenKinds, kind]
        }
      };
    }),
  toggleReviewHidden: () =>
    set((state) => ({
      filter: { ...state.filter, isReviewHidden: !state.filter.isReviewHidden }
    })),
  resetFilter: () => set({ filter: EMPTY_CHANGE_FILTER }),
  setViewMode: (viewMode) => set({ viewMode })
}));

export const useCompareSlotFile = (slot: CompareSlot) =>
  useCompareSessionStore((state) => state[slot]);

export const useCompareOptions = () =>
  useCompareSessionStore((state) => state.options);

export const useIsTextCompared = () =>
  useCompareSessionStore((state) => state.isTextCompared);

export const useCompletedComparison = () =>
  useCompareSessionStore((state) => state.completed);

export const useChangeFilter = () =>
  useCompareSessionStore((state) => state.filter);

export const useActiveChangeId = () =>
  useCompareSessionStore((state) => state.activeChangeId);

export const useRevealCount = () =>
  useCompareSessionStore((state) => state.revealCount);

export const useCompareViewMode = () =>
  useCompareSessionStore((state) => state.viewMode);

/** 세션에 든 문서 경로(A → B 슬롯, 그다음 끝난 결과의 두 문서. 빈 슬롯은 뺀다) */
export const useCompareFilePaths = () =>
  useCompareSessionStore(
    useShallow((state) => [
      ...COMPARE_SLOTS.flatMap((slot) => {
        const file = state[slot];
        return file ? [file.path] : [];
      }),
      ...COMPARE_SLOTS.flatMap((slot) =>
        state.completed ? [state.completed.files[slot].path] : []
      )
    ])
  );
