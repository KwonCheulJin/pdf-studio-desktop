import { ERROR_CODE } from "@/renderer/shared/config/error-messages";

/**
 * 소스 파일 하나를 열다 난 오류 코드. 파일 읽기 단계에서 이 코드로 실패하면
 * 그 단계의 진행률로 어느 파일인지 찾는다(`findFailedSourcePath`).
 */
export const SOURCE_FILE_ERROR_CODES: ReadonlySet<string> = new Set([
  ERROR_CODE.NOT_FOUND,
  ERROR_CODE.FILE_UNREADABLE,
  ERROR_CODE.INPUT_TOO_LARGE,
  ERROR_CODE.INVALID_PDF,
  ERROR_CODE.PASSWORD_PROTECTED,
  ERROR_CODE.PDFIUM_FAILURE,
  ERROR_CODE.INVALID_PAGE
]);
