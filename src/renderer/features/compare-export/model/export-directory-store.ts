import { create } from "zustand";

interface ExportDirectoryState {
  /** 폴더 다이얼로그에서 고른 내보내기 폴더. 앱을 다시 켜면 다시 고른다(허용 경로 목록은 실행마다 새로 시작). */
  directory: string | null;
  setDirectory: (directory: string) => void;
}

/** 내보내기 폴더. 모달을 닫았다 열거나 다른 결과를 내보내도 이 실행 동안 남는다. */
export const useExportDirectoryStore = create<ExportDirectoryState>((set) => ({
  directory: null,
  setDirectory: (directory) => set({ directory })
}));
