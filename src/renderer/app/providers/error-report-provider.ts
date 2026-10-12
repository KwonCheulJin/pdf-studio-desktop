import { isErrorReportingEnabled } from "@/renderer/features/error-reporting";
import {
  configureErrorReporter,
  createSnapshotTransport,
  readSnapshotFirebaseConfig,
  reportUncaughtErrors,
  type ErrorReportTransport
} from "@/renderer/shared/lib/error-report";
import { isTauriRuntime } from "@/renderer/shared/platform";
import { createE2eErrorReportTransport } from "./e2e-error-report";

/**
 * 오류를 보낼 곳을 고른다.
 * - 브라우저에서 띄운 개발 서버(E2E): 보내지 않고 테스트 기록 배열에만 남긴다.
 * - 그 밖: 빌드 환경 변수의 앱 전용 Firebase 설정. 없으면 `null`(오류 보고 기능 꺼짐).
 * 프로덕션 빌드에서 `import.meta.env.DEV`는 false라 E2E 모듈은 번들에서 빠진다.
 */
function selectTransport(): ErrorReportTransport | null {
  if (import.meta.env.DEV && !isTauriRuntime()) {
    return createE2eErrorReportTransport();
  }
  const firebase = readSnapshotFirebaseConfig(import.meta.env);
  return firebase ? createSnapshotTransport(firebase) : null;
}

/** 부팅 때 한 번 부른다. 보낼 곳이 없으면 오류 보고 기능을 켜지 않는다. */
export function provideErrorReporting(): void {
  const transport = selectTransport();
  if (!transport) return;
  configureErrorReporter({ transport, isEnabled: isErrorReportingEnabled });
  reportUncaughtErrors();
}
