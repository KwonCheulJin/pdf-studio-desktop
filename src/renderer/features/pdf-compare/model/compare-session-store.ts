import { create } from "zustand";

/** 비교할 문서 하나. 경로는 다이얼로그·드롭으로 받아 허용 경로 목록에 들어 있다(D13). */
export interface CompareFile {
  path: string;
  /** 화면에 보일 이름(`platform.fileStem`) */
  name: string;
}

interface CompareSessionState {
  /** A: 이전 문서 */
  before: CompareFile | null;
  /** B: 이후 문서 */
  after: CompareFile | null;
}

interface CompareSessionActions {
  /** 받은 순서대로 A, B에 넣는다. 하나뿐이면 B는 비운다. */
  setFiles: (files: CompareFile[]) => void;
}

type CompareSessionStore = CompareSessionState & CompareSessionActions;

/**
 * 비교 세션. 지금은 비교할 두 문서만 둔다(계획서 P3-1). 슬롯 UI·옵션·실행 상태는 다음 Step에서 더한다.
 * 모드를 바꿔도 남는다.
 */
export const useCompareSessionStore = create<CompareSessionStore>((set) => ({
  before: null,
  after: null,
  setFiles: ([before = null, after = null]) => set({ before, after })
}));

export const useCompareBeforeFile = () =>
  useCompareSessionStore((state) => state.before);
export const useCompareAfterFile = () =>
  useCompareSessionStore((state) => state.after);
