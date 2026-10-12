import type { AppError } from "@/renderer/shared/api/bindings";

/** 커맨드가 `AppError`가 아닌 값으로 실패했을 때(IPC 자체 실패 등)의 코드 */
export const PLATFORM_ERROR_CODE = {
  IPC_FAILED: "IPC_FAILED"
} as const;

/** 모든 플랫폼 구현이 던지는 에러. 화면 문구는 `code`로 고르고 `message`는 로그용이다. */
export class PlatformError extends Error implements AppError {
  readonly code: string;

  constructor({ code, message }: AppError) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
  }
}

function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

export function toPlatformError(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error;
  if (isAppError(error)) return new PlatformError(error);
  const message = error instanceof Error ? error.message : String(error);
  return new PlatformError({ code: PLATFORM_ERROR_CODE.IPC_FAILED, message });
}
