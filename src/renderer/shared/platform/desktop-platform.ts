import type {
  MergeOutput,
  MergeProgress,
  MergeRequest,
  MergeResult,
  OpenedFile
} from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";

export const LOG_LEVEL = {
  INFO: "info",
  WARN: "warn",
  ERROR: "error"
} as const;

export type LogLevel = ValueOf<typeof LOG_LEVEL>;

/** 병합 결과를 쓸 곳(`MergeOutput.kind`) */
export const MERGE_OUTPUT_KIND = {
  TEMP: "temp"
} as const satisfies Record<string, MergeOutput["kind"]>;

export interface PickSavePathOptions {
  /** 저장 다이얼로그에 처음 보일 파일 이름. 처음 보일 폴더는 플랫폼이 정한다. */
  fileName: string;
}

export type MergeProgressHandler = (progress: MergeProgress) => void;

export interface MergePdfsParams {
  request: MergeRequest;
  onProgress?: MergeProgressHandler;
}

export interface CopyFileParams {
  source: string;
  destination: string;
}

export interface LogParams {
  level: LogLevel;
  message: string;
}

/**
 * 프론트가 의존하는 데스크톱 기능. 파일 경로를 넘기고 결과(JSON)를 받는다.
 * 실패하면 `PlatformError`(`{ code, message }`)를 던진다.
 * `openFiles`는 파일별 실패를 결과에 담고, 요청 자체가 실패할 때만 던진다.
 */
export interface DesktopPlatform {
  /** 열기 다이얼로그. 취소하면 빈 목록 */
  pickFiles(): Promise<string[]>;
  /** 저장 다이얼로그. 취소하면 `null` */
  pickSavePath(options: PickSavePathOptions): Promise<string | null>;
  /** 확장자 판별·TIFF 변환·정보 조회. 입력 순서대로 파일별 결과 */
  openFiles(paths: string[]): Promise<OpenedFile[]>;
  /** pdf.js 표시 전용 PDF 바이트 */
  readPdf(path: string): Promise<Uint8Array>;
  mergePdfs(params: MergePdfsParams): Promise<MergeResult>;
  /** 이미 끝났거나 없는 작업이면 아무 일도 하지 않는다. */
  cancelJob(jobId: string): Promise<void>;
  /** 병합 미리보기 결과를 저장 다이얼로그에서 고른 경로로 복사 */
  copyFile(params: CopyFileParams): Promise<void>;
  /** 병합 미리보기 결과 하나를 지운다. */
  discardTemp(path: string): Promise<void>;
  log(params: LogParams): void;
}
