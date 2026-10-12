import type {
  ErrorReportMeta,
  ErrorReportTransport
} from "@/renderer/shared/lib/error-report";

/**
 * 브라우저 E2E용 오류 보고 기록. 개발 서버에서만 불린다(`error-report-provider.ts`의
 * `import.meta.env.DEV` 분기). 실제로 보내지 않고 보내기 직전(경로를 지운 뒤) 내용을 남긴다.
 */

/** 보내기 직전 보고 한 건 */
export interface E2eErrorReport {
  message: string;
  stack: string;
  meta: ErrorReportMeta;
}

declare global {
  interface Window {
    /** 테스트가 페이지 로드 전에 빈 배열로 넣으면 오류 보고 기능이 켜지고 보고가 여기에 쌓인다. */
    __E2E_ERROR_REPORTS__?: E2eErrorReport[];
  }
}

const E2E_ERROR_CODE_PREFIX = "E2E-";

/** 테스트가 기록 배열을 넣지 않았으면 `null` — 오류 보고 기능이 없는 빌드처럼 동작한다. */
export function createE2eErrorReportTransport(): ErrorReportTransport | null {
  const reports = window.__E2E_ERROR_REPORTS__;
  if (!reports) return null;
  return async ({ error, meta }) => {
    reports.push({ message: error.message, stack: error.stack ?? "", meta });
    return `${E2E_ERROR_CODE_PREFIX}${reports.length}`;
  };
}
