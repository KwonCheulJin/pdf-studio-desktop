import { maskError, maskReportValue } from "./mask-sensitive-text";

/** 오류와 함께 보내는 추가 필드 */
export type ErrorReportMeta = Record<string, unknown>;

/** 경로·파일 이름을 지운 뒤의 보고 */
export interface ErrorReport {
  error: Error;
  meta: ErrorReportMeta;
}

/** 보고를 실제로 보낸다. 사용자에게 보일 오류 코드를 돌려준다. */
export type ErrorReportTransport = (report: ErrorReport) => Promise<string>;

export interface ErrorReporterConfig {
  transport: ErrorReportTransport;
  /** 사용자가 설정에서 오류 보고를 켜 두었는지(보낼 때마다 묻는다) */
  isEnabled: () => boolean;
}

export interface ReportErrorParams {
  error: unknown;
  meta?: ErrorReportMeta;
}

/** 부팅 때 `app/providers`가 넣는다. 없으면 오류 보고 기능이 꺼져 있다. */
let reporterConfig: ErrorReporterConfig | null = null;

export function configureErrorReporter(config: ErrorReporterConfig): void {
  reporterConfig = config;
}

/** 오류 보고를 보낼 곳이 설정됐는지(빌드에 앱 전용 설정이 있을 때만 참) */
export function isErrorReportingAvailable(): boolean {
  return reporterConfig !== null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * 오류를 보고한다. 보낼 곳이 없거나 사용자가 껐으면 아무것도 보내지 않고 `null`.
 * 보내기 전에 메시지·스택·추가 필드의 파일 경로·이름을 지운다. 전송 실패도 `null`.
 */
export async function reportError({
  error,
  meta = {}
}: ReportErrorParams): Promise<string | null> {
  if (!reporterConfig?.isEnabled()) {
    return null;
  }
  const report: ErrorReport = {
    error: maskError(toError(error)),
    meta: Object.fromEntries(
      Object.entries(meta).map(([key, value]) => [key, maskReportValue(value)])
    )
  };
  try {
    return await reporterConfig.transport(report);
  } catch {
    return null;
  }
}

/** 처리되지 않은 오류(`error`, `unhandledrejection`)를 보고한다. 부팅 때 한 번 부른다. */
export function reportUncaughtErrors(): void {
  window.addEventListener("error", (event) => {
    void reportError({
      error: event.error ?? event.message,
      meta: { source: "window.onerror" }
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    void reportError({
      error: event.reason,
      meta: { source: "unhandledrejection" }
    });
  });
}
