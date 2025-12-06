// ============================================
// IPC Payload Types (Main/Preload/Renderer 공유)
// ============================================

// --- PDF Merge ---

export interface FilePayload {
  path: string;
  pages?: number[]; // 특정 페이지만 병합할 때
}

export interface MergeRequest {
  files: FilePayload[];
  outputPath?: string;
}

export interface MergeResult {
  outputPath: string;
  totalPages: number;
}

export interface MergeProgress {
  current: number;
  total: number;
  percentage: number;
}

// --- PDF Edit ---

export const PAGE_OPERATION_TYPE = {
  DELETE: "delete",
  REORDER: "reorder",
  ROTATE: "rotate"
} as const;

type ValueOf<T> = T[keyof T];
export type PageOperationType = ValueOf<typeof PAGE_OPERATION_TYPE>;

export const ROTATION_DEGREES = {
  DEG_0: 0,
  CW_90: 90,
  CW_180: 180,
  CW_270: 270
} as const;

export type RotationDegrees = ValueOf<typeof ROTATION_DEGREES>;

// 개별 페이지 회전 요청
export interface RotatePageRequest {
  filePath: string;
  pageIndex: number;
  rotationDegrees: RotationDegrees;
}

// 병합 시 페이지 정보 (회전 포함)
export interface PageInfo {
  sourceFilePath: string;
  sourcePageIndex: number;
  rotation?: RotationDegrees;
}

export interface PageOperation {
  type: PageOperationType;
  pageIndices: number[];
  newOrder?: number[]; // reorder 시 사용
  rotationDegrees?: RotationDegrees; // rotate 시 사용
}

export interface EditPageRequest {
  filePath: string;
  operations: PageOperation[];
}

// --- File Convert ---

export interface ConvertTiffRequest {
  tiffPath: string;
  outputDir?: string;
}

export interface ConvertResult {
  outputPdfPath: string;
  pageCount: number;
}

// --- File Read ---

export interface ReadPdfRequest {
  filePath: string;
}

export interface ReadPdfResult {
  data: Uint8Array;
  fileSize: number;
}

// --- Metadata ---

export interface PdfInfo {
  pageCount: number;
  title?: string;
}

// --- Dialog ---

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface DialogOpenOptions {
  filters?: FileFilter[];
}

export interface DialogSaveOptions {
  defaultPath?: string;
}

// --- Logging ---

export const LOG_LEVEL = {
  INFO: "info",
  WARN: "warn",
  ERROR: "error"
} as const;

export type LogLevel = ValueOf<typeof LOG_LEVEL>;

export interface LogPayload {
  level: LogLevel;
  message: string;
}
