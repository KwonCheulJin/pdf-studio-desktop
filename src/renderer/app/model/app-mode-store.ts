import { create } from "zustand";
import type { ValueOf } from "@/renderer/shared/types/common";

/** 앱 화면(라우터 없이 모드로 바꾼다, 계획서 D8). 홈은 첫 화면이고 툴바 탭에는 없다. */
export const APP_MODE = {
  HOME: "home",
  MERGE: "merge",
  COMPARE: "compare",
  TRANSLATE: "translate"
} as const;

export type AppMode = ValueOf<typeof APP_MODE>;

interface AppModeStore {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

/** 모드만 바꾼다. 모드마다의 작업 상태(병합 파일, 비교 세션)는 각자의 스토어에 그대로 남는다. */
export const useAppModeStore = create<AppModeStore>((set) => ({
  mode: APP_MODE.HOME,
  setMode: (mode) => set({ mode })
}));

export const useAppMode = () => useAppModeStore((state) => state.mode);
