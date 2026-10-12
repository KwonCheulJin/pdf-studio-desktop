import type { AppError, ErrorCode } from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";

/** 커맨드가 `AppError`가 아닌 값으로 실패했을 때(IPC 자체 실패 등)의 코드. 프론트만 만든다. */
export const PLATFORM_ERROR_CODE = {
  IPC_FAILED: "IPC_FAILED"
} as const;

/** 플랫폼이 던지는 오류 코드: Rust `ErrorCode`(바인딩) + 프론트 전용 코드 */
export type PlatformErrorCode = ErrorCode | ValueOf<typeof PLATFORM_ERROR_CODE>;

interface PlatformErrorParams {
  code: PlatformErrorCode;
  message: string;
  /** 실패를 일으킨 입력 파일(`AppError.path`). 모르면 `null` */
  path: string | null;
}

/** 모든 플랫폼 구현이 던지는 에러. 화면 문구는 `code`로 고르고 `message`는 로그용이다. */
export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly path: string | null;

  constructor({ code, message, path }: PlatformErrorParams) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
    this.path = path;
  }
}

/** IPC로 받은 값이 `AppError` 모양인지. 코드 값 자체는 화면 문구 표에서 다시 확인한다. */
function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    "path" in value &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    (value.path === null || typeof value.path === "string")
  );
}

export function toPlatformError(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error;
  if (isAppError(error)) return new PlatformError(error);
  const message = error instanceof Error ? error.message : String(error);
  return new PlatformError({
    code: PLATFORM_ERROR_CODE.IPC_FAILED,
    message,
    path: null
  });
}
