import type { PlatformErrorCode } from "@/renderer/shared/platform";

/**
 * 병합 실패 화면에서 원인(`getErrorMessage`) 뒤에 붙이는 해결 방법(시안 8).
 * 원인 문구에 이미 할 일이 들어 있는 코드(저장 실패·접근 불가 등)와
 * 병합에서 나오지 않는 코드(TIFF 변환 등)는 두지 않는다.
 */
const MERGE_FAILURE_RESOLUTION: Partial<Record<PlatformErrorCode, string>> = {
  PASSWORD_PROTECTED: "암호를 풀거나 이 파일을 빼고 다시 병합하세요.",
  INVALID_PDF:
    "다른 프로그램에서 다시 저장하거나 이 파일을 빼고 다시 병합하세요.",
  NOT_FOUND: "파일을 다시 추가하거나 이 파일을 빼고 다시 병합하세요.",
  FILE_UNREADABLE: "파일 권한을 확인하거나 이 파일을 빼고 다시 병합하세요.",
  INPUT_TOO_LARGE: "파일을 나누거나 이 파일을 빼고 다시 병합하세요.",
  EMPTY_SOURCE: "이 파일을 빼고 다시 병합하세요.",
  INVALID_PAGE: "파일을 다시 추가하거나 이 파일을 빼고 다시 병합하세요.",
  UNSUPPORTED_FILE_TYPE: "이 파일을 빼고 다시 병합하세요.",
  PDFIUM_FAILURE:
    "다시 시도하고, 계속 실패하면 문제가 된 파일을 빼고 병합하세요.",
  TOO_MANY_FILES: "파일을 나눠서 여러 번 병합하세요.",
  OUTPUT_DIRECTORY_NOT_FOUND: "앱을 다시 시작한 뒤 다시 병합하세요.",
  JOB_ALREADY_RUNNING: "진행 중인 병합이 끝난 뒤 다시 시도하세요.",
  TASK_FAILED: "다시 시도하세요.",
  EMPTY_REQUEST: "삭제한 페이지를 복원하거나 파일을 추가한 뒤 병합하세요."
};

/** 병합 실패 코드의 해결 방법. 따로 둔 문장이 없으면 `null` */
export function getMergeFailureResolution(
  code: PlatformErrorCode
): string | null {
  return Object.prototype.hasOwnProperty.call(MERGE_FAILURE_RESOLUTION, code)
    ? (MERGE_FAILURE_RESOLUTION[code] ?? null)
    : null;
}
