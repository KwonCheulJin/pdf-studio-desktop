import type {
  CompareProgress,
  CompareRequest,
  CompareResult,
  ExportAnnotatedPdfRequest,
  ExportComparePdfRequest,
  ExportedFile,
  MergeOutput,
  MergeProgress,
  MergeRequest,
  MergeResult,
  OpenedFile,
  PreviewCompareReportRequest,
  ReportPreview
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

export interface PickSaveDirectoryOptions {
  /** 폴더 다이얼로그가 처음 보일 폴더. `null`이면 플랫폼이 정한다(문서 폴더). */
  defaultDirectory: string | null;
}

export type MergeProgressHandler = (progress: MergeProgress) => void;

export interface MergePdfsParams {
  request: MergeRequest;
  onProgress?: MergeProgressHandler;
}

export type CompareProgressHandler = (progress: CompareProgress) => void;

export interface ComparePdfsParams {
  request: CompareRequest;
  onProgress?: CompareProgressHandler;
}

export interface CopyFileParams {
  source: string;
  destination: string;
}

export interface LogParams {
  level: LogLevel;
  message: string;
}

/** 창 밖에서 파일을 끌어올 때 오는 이벤트 종류 */
export const FILE_DROP_EVENT_TYPE = {
  ENTER: "enter",
  OVER: "over",
  DROP: "drop",
  LEAVE: "leave"
} as const;

/** 웹뷰 기준 CSS 픽셀 좌표(`document.elementFromPoint`에 그대로 넘긴다) */
export interface ClientPoint {
  x: number;
  y: number;
}

export interface FileDropEnterEvent {
  type: typeof FILE_DROP_EVENT_TYPE.ENTER;
  paths: string[];
  point: ClientPoint;
}

export interface FileDropOverEvent {
  type: typeof FILE_DROP_EVENT_TYPE.OVER;
  point: ClientPoint;
}

/** 놓은 파일 경로는 이 이벤트가 오기 전에 허용 경로 목록에 기록돼 있다(D13). */
export interface FileDropDropEvent {
  type: typeof FILE_DROP_EVENT_TYPE.DROP;
  paths: string[];
  point: ClientPoint;
}

export interface FileDropLeaveEvent {
  type: typeof FILE_DROP_EVENT_TYPE.LEAVE;
}

export type FileDropEvent =
  | FileDropEnterEvent
  | FileDropOverEvent
  | FileDropDropEvent
  | FileDropLeaveEvent;

export type FileDropHandler = (event: FileDropEvent) => void;

/** 설정 저장소에 넣는 값 */
export type SettingValue = string | boolean;

export interface SetSettingParams {
  key: string;
  value: SettingValue;
}

/** 구독을 끊는다. 여러 번 불러도 된다. */
export type Unsubscribe = () => void;

/**
 * 프론트가 의존하는 데스크톱 기능. 파일 경로를 넘기고 결과(JSON)를 받는다.
 * 실패하면 `PlatformError`(`{ code, message, path }`)를 던진다.
 * `openFiles`는 파일별 실패를 결과에 담고, 요청 자체가 실패할 때만 던진다.
 */
export interface DesktopPlatform {
  /** 열기 다이얼로그. 취소하면 빈 목록 */
  pickFiles(): Promise<string[]>;
  /** 저장 다이얼로그. 취소하면 `null` */
  pickSavePath(options: PickSavePathOptions): Promise<string | null>;
  /** 내보내기 폴더를 고르는 다이얼로그. 고른 폴더 바로 안에만 새 파일을 만들 수 있다. 취소하면 `null` */
  pickSaveDirectory(options: PickSaveDirectoryOptions): Promise<string | null>;
  /** 확장자 판별·TIFF 변환·정보 조회. 입력 순서대로 파일별 결과 */
  openFiles(paths: string[]): Promise<OpenedFile[]>;
  /**
   * 경로의 마지막 이름에서 확장자를 뺀 것(열기 전 자리표시·열기 실패 알림용).
   * 렌더러는 경로 문자열을 자르지 않고 이 메서드를 쓴다. 이름이 없는 경로면 경로 그대로다.
   */
  fileStem(path: string): Promise<string>;
  /** pdf.js 표시 전용 PDF 바이트 */
  readPdf(path: string): Promise<Uint8Array>;
  mergePdfs(params: MergePdfsParams): Promise<MergeResult>;
  /** 두 PDF 비교. 원본은 읽기만 한다. 취소는 `cancelJob(request.jobId)` */
  comparePdfs(params: ComparePdfsParams): Promise<CompareResult>;
  /** 비교 PDF의 앞 몇 장 그림(PNG base64)과 전체 장 수. 넣을 장이 없으면 `EMPTY_REPORT`로 실패한다. */
  previewCompareReport(
    request: PreviewCompareReportRequest
  ): Promise<ReportPreview>;
  /**
   * 비교 PDF를 고른 폴더에 만든다. 같은 이름이 있으면 번호를 붙인 새 이름으로 만든다.
   * 취소는 `cancelJob(request.jobId)`
   */
  exportComparePdf(request: ExportComparePdfRequest): Promise<ExportedFile>;
  /** B 사본에 차이를 주석으로 단 PDF를 고른 폴더에 만든다. 취소는 `cancelJob(request.jobId)` */
  exportAnnotatedPdf(request: ExportAnnotatedPdfRequest): Promise<ExportedFile>;
  /** 이미 끝났거나 없는 작업이면 아무 일도 하지 않는다. */
  cancelJob(jobId: string): Promise<void>;
  /** 병합 미리보기 결과를 저장 다이얼로그에서 고른 경로로 복사 */
  copyFile(params: CopyFileParams): Promise<void>;
  /** 병합 미리보기 결과 하나를 지운다. */
  discardTemp(path: string): Promise<void>;
  log(params: LogParams): void;
  /** 창 밖에서 끌어온 파일의 드래그·드롭. 좌표는 CSS 픽셀로 바꿔 넘긴다. */
  onFileDrop(handler: FileDropHandler): Unsubscribe;
  /**
   * 앱 설정 하나를 읽는다. 없으면 `undefined`. 저장된 값은 손상됐을 수 있으므로
   * 쓰는 쪽이 모양을 확인한다.
   */
  getSetting(key: string): Promise<unknown>;
  /** 앱 설정 하나를 쓰고 재시작해도 남도록 저장한다. */
  setSetting(params: SetSettingParams): Promise<void>;
  /** 앱과 함께 번들한 제3자 고지(`THIRD_PARTY_NOTICES.md` 마크다운 원문) */
  readThirdPartyNotices(): Promise<string>;
}
