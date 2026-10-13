import {
  MAX_GLOSSARY_TERM_CHARS,
  MAX_GLOSSARY_TERMS
} from "@/renderer/shared/api/bindings";
import type { PlatformErrorCode } from "@/renderer/shared/platform";

/** 표에 없는 코드에 보이는 문구 */
export const UNKNOWN_ERROR_MESSAGE =
  "알 수 없는 오류가 생겼어요. 다시 시도해 주세요.";

/**
 * 오류 코드 → 화면 문구(해요체, 원인). 화면은 이 표만 쓰고, 플랫폼 `message`는 로그로만 남긴다.
 * 코드는 Rust `ErrorCode`(바인딩)와 프론트 전용 `PLATFORM_ERROR_CODE`이고, 하나라도 빠지면 타입 오류다.
 */
const ERROR_MESSAGES: Record<PlatformErrorCode, string> = {
  PATH_NOT_ALLOWED: "이 파일에 접근할 수 없어요. 파일을 다시 추가해 주세요.",
  UNSUPPORTED_FILE_TYPE:
    "지원하지 않는 파일 형식이에요. PDF·TIF·TIFF만 열 수 있어요.",
  OUTPUT_IS_SOURCE:
    "원본 파일에는 덮어쓸 수 없어요. 다른 이름으로 저장해 주세요.",
  JOB_ALREADY_RUNNING: "같은 작업이 이미 진행 중이에요.",
  INVALID_DIALOG_PATH: "선택한 위치를 쓸 수 없어요.",
  ENGINE_UNAVAILABLE:
    "PDF 처리 엔진을 불러오지 못했어요. 앱을 다시 시작해 주세요.",
  NOT_READY: "앱이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.",
  TASK_FAILED: "작업을 처리하지 못했어요.",
  RESOURCE_UNAVAILABLE:
    "앱에 함께 들어 있는 파일을 읽지 못했어요. 앱을 다시 설치해 주세요.",
  NOT_FOUND: "파일을 찾을 수 없어요. 옮겨졌거나 지워졌어요.",
  FILE_UNREADABLE: "파일을 읽을 수 없어요.",
  INPUT_TOO_LARGE: "파일이 너무 커서 열 수 없어요.",
  INVALID_PDF: "PDF 파일이 손상되었거나 형식이 올바르지 않아요.",
  PASSWORD_PROTECTED: "암호가 걸린 PDF라 열 수 없어요.",
  PDFIUM_FAILURE: "PDF를 처리하는 중 문제가 생겼어요.",
  OUTPUT_DIRECTORY_NOT_FOUND: "저장할 폴더를 찾을 수 없어요.",
  WRITE_FAILED: "파일을 저장하지 못했어요. 저장 공간과 권한을 확인해 주세요.",
  EMPTY_REQUEST: "병합할 페이지가 없어요.",
  TOO_MANY_FILES: "한 번에 병합할 수 있는 파일 수를 넘었어요.",
  EMPTY_SOURCE: "페이지가 없는 파일이 있어요.",
  INVALID_PAGE: "파일에 없는 페이지가 들어 있어요. 파일이 바뀌었을 수 있어요.",
  CANCELLED: "작업을 취소했어요.",
  INVALID_RANGE:
    "페이지 범위가 올바르지 않아요. 문서 쪽수 안에서 1,3-5처럼 써 주세요.",
  EMPTY_REPORT: "지금 필터로는 내보낼 쪽이 없어요.",
  IMAGE_ENCODE_FAILED: "미리보기 그림을 만들지 못했어요.",
  INVALID_TIFF: "TIFF 파일이 손상되었거나 형식이 올바르지 않아요.",
  UNSUPPORTED_TIFF_COMPRESSION: "지원하지 않는 압축 방식의 TIFF 파일이에요.",
  UNSUPPORTED_TIFF_FORMAT: "지원하지 않는 형식의 TIFF 파일이에요.",
  IMAGE_TOO_LARGE: "이미지가 너무 커서 변환할 수 없어요.",
  API_KEY_MISSING:
    "API 키가 등록되지 않았어요. 설정 › 번역에서 키를 등록해 주세요.",
  API_KEY_INVALID: "API 키가 올바르지 않아요. 키를 다시 확인해 주세요.",
  API_PERMISSION_DENIED:
    "이 API 키로는 번역할 권한이 없어요. Anthropic 콘솔에서 키 권한을 확인해 주세요.",
  API_BILLING:
    "Anthropic 계정의 잔액이나 월 지출 한도가 부족해요. 콘솔에서 결제 상태를 확인해 주세요.",
  MODEL_UNAVAILABLE: "번역 모델을 쓸 수 없어요. 앱을 업데이트해 주세요.",
  API_REQUEST_REJECTED:
    "Anthropic API가 요청을 받지 않았어요. 콘솔의 지출 한도를 확인하거나 잠시 후 다시 시도해 주세요.",
  API_RATE_LIMITED:
    "요청이 많아 잠시 막혔어요. 잠시 후 이어서 다시 시도해 주세요.",
  API_UNAVAILABLE:
    "Anthropic API가 지금 응답하지 않아요. 잠시 후 이어서 다시 시도해 주세요.",
  API_TIMEOUT: "응답이 너무 늦어 멈췄어요. 잠시 후 이어서 다시 시도해 주세요.",
  NETWORK_UNAVAILABLE:
    "인터넷에 연결할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요.",
  TRANSLATION_MISMATCH:
    "번역 응답이 문단과 맞지 않았어요. 이 문단을 다시 번역해 주세요.",
  TRANSLATION_TRUNCATED:
    "번역이 너무 길어 끝까지 받지 못했어요. 이 문단을 다시 번역해 주세요.",
  TRANSLATION_REFUSED:
    "모델이 이 글의 번역을 거절했어요. 다른 모델로 다시 번역해 볼 수 있어요.",
  KEYCHAIN_UNAVAILABLE:
    "이 컴퓨터의 키체인을 쓸 수 없어 API 키를 저장하거나 읽지 못했어요.",
  NO_TRANSLATABLE_TEXT: "범위 안에 번역할 글이 없어요.",
  SOURCE_LANGUAGE_UNKNOWN: "원문 언어를 알 수 없어요. 원문 언어를 골라 주세요.",
  TRANSLATION_RECORD_NOT_FOUND:
    "저장된 번역을 찾을 수 없어요. 파일이 바뀌었거나 저장된 번역을 지웠어요. 다시 번역해 주세요.",
  GLOSSARY_TOO_LARGE: `용어집이 너무 커요. 용어는 ${MAX_GLOSSARY_TERMS}개, 원어·번역어는 ${MAX_GLOSSARY_TERM_CHARS}자까지 넣을 수 있어요.`,
  IPC_FAILED: "앱 내부 통신에 실패했어요. 다시 시도해 주세요."
};

/** 오류 코드의 화면 문구. IPC로 온 값이라 표에 없는 코드가 오면 일반 문구 */
export function getErrorMessage(code: PlatformErrorCode): string {
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
    ? ERROR_MESSAGES[code]
    : UNKNOWN_ERROR_MESSAGE;
}
