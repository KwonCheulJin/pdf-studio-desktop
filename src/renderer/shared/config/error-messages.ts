import type { ValueOf } from "@/renderer/shared/types/common";

/**
 * 플랫폼이 던지는 오류 코드(`PlatformError.code`).
 * 정본은 Rust(`src-tauri/src/error.rs`, `crates/pdf-core`의 `code()`)이고,
 * 바인딩에 코드 union이 없어 같은 값을 여기에 둔다. `IPC_FAILED`만 프론트가 만든다.
 */
export const ERROR_CODE = {
  // src-tauri 커맨드
  PATH_NOT_ALLOWED: "PATH_NOT_ALLOWED",
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  OUTPUT_IS_SOURCE: "OUTPUT_IS_SOURCE",
  JOB_ALREADY_RUNNING: "JOB_ALREADY_RUNNING",
  INVALID_DIALOG_PATH: "INVALID_DIALOG_PATH",
  ENGINE_UNAVAILABLE: "ENGINE_UNAVAILABLE",
  NOT_READY: "NOT_READY",
  TASK_FAILED: "TASK_FAILED",
  // pdf-core 문서 열기
  NOT_FOUND: "NOT_FOUND",
  FILE_UNREADABLE: "FILE_UNREADABLE",
  INPUT_TOO_LARGE: "INPUT_TOO_LARGE",
  INVALID_PDF: "INVALID_PDF",
  PASSWORD_PROTECTED: "PASSWORD_PROTECTED",
  PDFIUM_FAILURE: "PDFIUM_FAILURE",
  // pdf-core 저장
  OUTPUT_DIRECTORY_NOT_FOUND: "OUTPUT_DIRECTORY_NOT_FOUND",
  WRITE_FAILED: "WRITE_FAILED",
  // pdf-core 병합
  EMPTY_REQUEST: "EMPTY_REQUEST",
  TOO_MANY_FILES: "TOO_MANY_FILES",
  EMPTY_SOURCE: "EMPTY_SOURCE",
  INVALID_PAGE: "INVALID_PAGE",
  CANCELLED: "CANCELLED",
  // pdf-core TIFF 변환
  INVALID_TIFF: "INVALID_TIFF",
  UNSUPPORTED_TIFF_COMPRESSION: "UNSUPPORTED_TIFF_COMPRESSION",
  UNSUPPORTED_TIFF_FORMAT: "UNSUPPORTED_TIFF_FORMAT",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  // 프론트: 커맨드가 `AppError`가 아닌 값으로 실패(IPC 자체 실패 등)
  IPC_FAILED: "IPC_FAILED"
} as const;

export type ErrorCode = ValueOf<typeof ERROR_CODE>;

/** 표에 없는 코드에 보이는 문구 */
export const UNKNOWN_ERROR_MESSAGE =
  "알 수 없는 오류가 발생했습니다. 다시 시도해 주세요.";

/** 오류 코드 → 화면 문구. 화면은 이 표만 쓰고, 플랫폼 `message`는 로그로만 남긴다. */
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODE.PATH_NOT_ALLOWED]:
    "이 파일에 접근할 수 없습니다. 파일을 다시 추가해 주세요.",
  [ERROR_CODE.UNSUPPORTED_FILE_TYPE]:
    "지원하지 않는 파일 형식입니다. PDF·TIF·TIFF만 열 수 있습니다.",
  [ERROR_CODE.OUTPUT_IS_SOURCE]:
    "원본 파일에는 덮어쓸 수 없습니다. 다른 이름으로 저장해 주세요.",
  [ERROR_CODE.JOB_ALREADY_RUNNING]: "같은 작업이 이미 진행 중입니다.",
  [ERROR_CODE.INVALID_DIALOG_PATH]: "선택한 위치를 사용할 수 없습니다.",
  [ERROR_CODE.ENGINE_UNAVAILABLE]:
    "PDF 처리 엔진을 불러오지 못했습니다. 앱을 다시 시작해 주세요.",
  [ERROR_CODE.NOT_READY]:
    "앱이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.",
  [ERROR_CODE.TASK_FAILED]: "작업을 처리하지 못했습니다.",
  [ERROR_CODE.NOT_FOUND]: "파일을 찾을 수 없습니다. 옮겨졌거나 지워졌습니다.",
  [ERROR_CODE.FILE_UNREADABLE]: "파일을 읽을 수 없습니다.",
  [ERROR_CODE.INPUT_TOO_LARGE]: "파일이 너무 커서 열 수 없습니다.",
  [ERROR_CODE.INVALID_PDF]: "PDF 파일이 손상되었거나 형식이 올바르지 않습니다.",
  [ERROR_CODE.PASSWORD_PROTECTED]: "암호가 걸린 PDF는 열 수 없습니다.",
  [ERROR_CODE.PDFIUM_FAILURE]: "PDF를 처리하는 중 문제가 생겼습니다.",
  [ERROR_CODE.OUTPUT_DIRECTORY_NOT_FOUND]: "저장할 폴더를 찾을 수 없습니다.",
  [ERROR_CODE.WRITE_FAILED]:
    "파일을 저장하지 못했습니다. 저장 공간과 권한을 확인해 주세요.",
  [ERROR_CODE.EMPTY_REQUEST]: "병합할 페이지가 없습니다.",
  [ERROR_CODE.TOO_MANY_FILES]: "한 번에 병합할 수 있는 파일 수를 넘었습니다.",
  [ERROR_CODE.EMPTY_SOURCE]: "페이지가 없는 파일이 있습니다.",
  [ERROR_CODE.INVALID_PAGE]:
    "파일에 없는 페이지가 들어 있습니다. 파일이 바뀌었을 수 있습니다.",
  [ERROR_CODE.CANCELLED]: "작업을 취소했습니다.",
  [ERROR_CODE.INVALID_TIFF]:
    "TIFF 파일이 손상되었거나 형식이 올바르지 않습니다.",
  [ERROR_CODE.UNSUPPORTED_TIFF_COMPRESSION]:
    "지원하지 않는 압축 방식의 TIFF 파일입니다.",
  [ERROR_CODE.UNSUPPORTED_TIFF_FORMAT]: "지원하지 않는 형식의 TIFF 파일입니다.",
  [ERROR_CODE.IMAGE_TOO_LARGE]: "이미지가 너무 커서 변환할 수 없습니다.",
  [ERROR_CODE.IPC_FAILED]: "앱 내부 통신에 실패했습니다. 다시 시도해 주세요."
};

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(ERROR_CODE)
);

function isErrorCode(code: string): code is ErrorCode {
  return KNOWN_ERROR_CODES.has(code);
}

/** 오류 코드의 화면 문구. 모르는 코드면 일반 문구 */
export function getErrorMessage(code: string): string {
  return isErrorCode(code) ? ERROR_MESSAGES[code] : UNKNOWN_ERROR_MESSAGE;
}
