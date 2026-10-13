import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  COMPARE_SLOT,
  COMPARE_SLOTS,
  type CompareSlot
} from "../config/compare-files";

/** 비교할 문서 하나(`openFiles`로 연 PDF) */
export interface CompareFile {
  /** 비교·표시에 쓸 PDF 경로. 다이얼로그·드롭으로 받아 허용 경로 목록에 들어 있다(D13). */
  path: string;
  /** 화면에 보일 이름(확장자 포함) */
  name: string;
  sizeBytes: number;
  pageCount: number;
}

type CompareSessionState = Record<CompareSlot, CompareFile | null>;

interface SetSlotFileParams {
  slot: CompareSlot;
  file: CompareFile;
}

interface CompareSessionActions {
  /** 슬롯에 넣는다. 이미 있으면 바꾼다. */
  setSlotFile: (params: SetSlotFileParams) => void;
  /** A(이전)와 B(이후)를 맞바꾼다. 한쪽이 비어 있으면 빈 자리도 함께 옮긴다. */
  swapSlots: () => void;
}

type CompareSessionStore = CompareSessionState & CompareSessionActions;

/**
 * 비교 세션. 지금은 비교할 두 문서(A 이전 · B 이후)만 둔다(계획서 P3-2).
 * 옵션·실행 상태는 다음 Step에서 더한다. 모드를 바꿔도 남는다.
 */
export const useCompareSessionStore = create<CompareSessionStore>((set) => ({
  [COMPARE_SLOT.BEFORE]: null,
  [COMPARE_SLOT.AFTER]: null,
  setSlotFile: ({ slot, file }) => set({ [slot]: file }),
  swapSlots: () =>
    set((state) => ({
      [COMPARE_SLOT.BEFORE]: state[COMPARE_SLOT.AFTER],
      [COMPARE_SLOT.AFTER]: state[COMPARE_SLOT.BEFORE]
    }))
}));

export const useCompareSlotFile = (slot: CompareSlot) =>
  useCompareSessionStore((state) => state[slot]);

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
