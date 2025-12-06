import { create } from "zustand";
import type { PdfDocument } from "./pdf-document";
import { MERGE_STATUS, type MergeStatus } from "./merge-state";

interface MergeStoreState {
  files: PdfDocument[];
  status: MergeStatus;
  progress: number;
  errorMessage: string | null;
}

interface MergeStoreActions {
  addFiles: (documents: PdfDocument[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  reorderFiles: (fromIndex: number, toIndex: number) => void;
  setStatus: (status: MergeStatus) => void;
  setProgress: (progress: number) => void;
  setError: (message: string | null) => void;
  reset: () => void;
}

type MergeStore = MergeStoreState & MergeStoreActions;

const initialState: MergeStoreState = {
  files: [],
  status: MERGE_STATUS.IDLE,
  progress: 0,
  errorMessage: null,
};

export const useMergeStore = create<MergeStore>((set) => ({
  ...initialState,

  addFiles: (documents) =>
    set((state) => ({
      files: [...state.files, ...documents],
    })),

  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((file) => file.id !== id),
    })),

  clearFiles: () =>
    set({
      files: [],
      status: MERGE_STATUS.IDLE,
      progress: 0,
      errorMessage: null,
    }),

  reorderFiles: (fromIndex, toIndex) =>
    set((state) => {
      const newFiles = [...state.files];
      const [movedFile] = newFiles.splice(fromIndex, 1);
      newFiles.splice(toIndex, 0, movedFile);
      return { files: newFiles };
    }),

  setStatus: (status) => set({ status }),

  setProgress: (progress) => set({ progress }),

  setError: (message) =>
    set({
      errorMessage: message,
      status: message ? MERGE_STATUS.ERROR : MERGE_STATUS.IDLE,
    }),

  reset: () => set(initialState),
}));

// Selector hooks
export const useMergeFiles = () => useMergeStore((state) => state.files);
export const useMergeStatus = () => useMergeStore((state) => state.status);
export const useMergeProgress = () => useMergeStore((state) => state.progress);
export const useTotalPages = () =>
  useMergeStore((state) =>
    state.files.reduce((sum, file) => sum + file.pageCount, 0)
  );
