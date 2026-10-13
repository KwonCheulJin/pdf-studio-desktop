import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
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

/** 비교할 문서 하나(`openFiles`로 연 PDF) */
export interface CompareFile {
  /** 비교·표시에 쓸 PDF 경로. 다이얼로그·드롭으로 받아 허용 경로 목록에 들어 있다(D13). */
  path: string;
  /** 화면에 보일 이름(확장자 포함) */
  name: string;
  sizeBytes: number;
  pageCount: number;
}

/** 실행 중이 아닐 때 비교 화면이 보이는 곳 */
export const COMPARE_VIEW = {
  OPTIONS: "options",
  RESULT: "result"
} as const;

export type CompareView = ValueOf<typeof COMPARE_VIEW>;

interface CompareSessionState extends Record<CompareSlot, CompareFile | null> {
  /** Rust로 보낼 옵션(쪽 범위·줄 제외·대소문자) */
  options: CompareOptions;
  /** 비교 대상 "글자"를 켰는가. 지금 비교할 수 있는 대상이 글자뿐이라 끄면 실행할 수 없다. */
  isTextCompared: boolean;
  /** 마지막으로 끝난 비교 결과. 결과 화면(Step 27)이 쓴다. */
  result: CompareResult | null;
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
  /** 슬롯에 넣는다. 이미 있으면 바꾼다. */
  setSlotFile: (params: SetSlotFileParams) => void;
  /** A(이전)와 B(이후)를 맞바꾼다. 한쪽이 비어 있으면 빈 자리도 함께 옮긴다. */
  swapSlots: () => void;
  setRange: (params: SetRangeParams) => void;
  setLineExcluded: (params: SetLineExcludedParams) => void;
  setIgnoreCase: (ignoreCase: boolean) => void;
  setTextCompared: (isTextCompared: boolean) => void;
  /** 옵션을 기본값으로 */
  resetOptions: () => void;
  /** 끝난 비교의 결과를 두고 결과 화면으로 */
  showResult: (result: CompareResult) => void;
  /** 옵션 화면으로(결과는 남긴다) */
  showOptions: () => void;
}

type CompareSessionStore = CompareSessionState & CompareSessionActions;

/**
 * 비교 세션: 비교할 두 문서(A 이전 · B 이후), 실행 전 옵션, 마지막 결과(계획서 P3-2·P3-3).
 * 진행 중인 작업의 진행률은 `compare-run-store`가 갖는다. 모드를 바꿔도 남는다.
 */
export const useCompareSessionStore = create<CompareSessionStore>((set) => ({
  [COMPARE_SLOT.BEFORE]: null,
  [COMPARE_SLOT.AFTER]: null,
  options: DEFAULT_COMPARE_OPTIONS,
  isTextCompared: true,
  result: null,
  view: COMPARE_VIEW.OPTIONS,
  setSlotFile: ({ slot, file }) => set({ [slot]: file }),
  swapSlots: () =>
    set((state) => ({
      [COMPARE_SLOT.BEFORE]: state[COMPARE_SLOT.AFTER],
      [COMPARE_SLOT.AFTER]: state[COMPARE_SLOT.BEFORE]
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
  showResult: (result) => set({ result, view: COMPARE_VIEW.RESULT }),
  showOptions: () => set({ view: COMPARE_VIEW.OPTIONS })
}));

export const useCompareSlotFile = (slot: CompareSlot) =>
  useCompareSessionStore((state) => state[slot]);

export const useCompareOptions = () =>
  useCompareSessionStore((state) => state.options);

export const useIsTextCompared = () =>
  useCompareSessionStore((state) => state.isTextCompared);

/** 세션에 든 문서 경로(A → B, 빈 슬롯은 뺀다) */
export const useCompareFilePaths = () =>
  useCompareSessionStore(
    useShallow((state) =>
      COMPARE_SLOTS.flatMap((slot) => {
        const file = state[slot];
        return file ? [file.path] : [];
      })
    )
  );
