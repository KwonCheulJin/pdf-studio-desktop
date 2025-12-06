import type { PdfDocument } from './pdf-document';

// Merge 상태 타입

export const MERGE_STATUS = {
  IDLE: 'idle',
  MERGING: 'merging',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;

type ValueOf<T> = T[keyof T];
export type MergeStatus = ValueOf<typeof MERGE_STATUS>;

export interface MergeState {
  files: PdfDocument[];
  totalPages: number;
  status: MergeStatus;
  progress: number; // 0-100
  errorMessage?: string;
}

export const INITIAL_MERGE_STATE: MergeState = {
  files: [],
  totalPages: 0,
  status: MERGE_STATUS.IDLE,
  progress: 0,
};
