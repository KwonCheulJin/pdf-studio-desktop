import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/** 번역할 문서(`openFiles`로 연 PDF) */
export interface TranslateFile {
  /** 표시에 쓸 PDF 경로. 다이얼로그·드롭으로 받아 허용 경로 목록에 들어 있다(D13). */
  path: string;
  /** 화면에 보일 이름(확장자 포함) */
  name: string;
  sizeBytes: number;
  pageCount: number;
}

interface TranslateSessionState {
  file: TranslateFile | null;
  setFile: (file: TranslateFile) => void;
}

/** 번역 세션. 모드를 바꿔도 이 스토어에 그대로 남는다(계획서 P6-7). */
export const useTranslateSessionStore = create<TranslateSessionState>(
  (set) => ({
    file: null,
    setFile: (file) => set({ file })
  })
);

export const useTranslateFile = () =>
  useTranslateSessionStore((state) => state.file);

/** 세션에 든 문서 경로(없으면 빈 목록). 모드를 오가도 문서를 다시 읽지 않게 잡아 두는 데 쓴다. */
export const useTranslateFilePaths = () =>
  useTranslateSessionStore(
    useShallow((state) => (state.file ? [state.file.path] : []))
  );
