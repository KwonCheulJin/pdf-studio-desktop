import type {
  ErrorSnapshotConfig,
  ErrorSnapshotInstance
} from "@kwoncheulJin/error-snapshot";
import type { ErrorReportTransport } from "./error-reporter";

/** 이 앱 전용 Firebase 프로젝트 설정 */
export type SnapshotFirebaseConfig = NonNullable<
  ErrorSnapshotConfig["firebase"]
>;

/** 대시보드에서 이 앱을 고르는 식별자와 오류 코드 접두사(`PDF-20260401-1423-A3F2`) */
const SNAPSHOT_PROJECT_ID = "pdf-studio";
const SNAPSHOT_APP_PREFIX = "PDF";

/** 화면 캡처는 파일 이름이 보이므로 하지 않는다. 라이브러리는 캡처 실패를 건너뛰고 보낸다. */
const SCREENSHOT_DISABLED_MESSAGE = "오류 보고에 화면 캡처를 넣지 않는다.";

function disableScreenshot(): HTMLElement {
  throw new Error(SCREENSHOT_DISABLED_MESSAGE);
}

/**
 * 빌드 환경 변수에서 앱 전용 Firebase 설정을 읽는다. 필수 값(API 키, 프로젝트 ID,
 * 저장소 버킷)이 하나라도 없으면 `null` — 오류 보고 기능 자체를 끈다.
 * 라이브러리 기본 Firebase 프로젝트로는 보내지 않는다.
 */
export function readSnapshotFirebaseConfig(
  env: ImportMetaEnv
): SnapshotFirebaseConfig | null {
  const apiKey = env.VITE_ERROR_SNAPSHOT_FIREBASE_API_KEY;
  const projectId = env.VITE_ERROR_SNAPSHOT_FIREBASE_PROJECT_ID;
  const storageBucket = env.VITE_ERROR_SNAPSHOT_FIREBASE_STORAGE_BUCKET;
  if (!apiKey || !projectId || !storageBucket) {
    return null;
  }
  return {
    apiKey,
    projectId,
    storageBucket,
    authDomain: env.VITE_ERROR_SNAPSHOT_FIREBASE_AUTH_DOMAIN,
    messagingSenderId: env.VITE_ERROR_SNAPSHOT_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_ERROR_SNAPSHOT_FIREBASE_APP_ID
  };
}

/**
 * `@kwoncheulJin/error-snapshot`으로 Firestore에 보낸다. 라이브러리(와 Firebase)는
 * 처음 보낼 때 불러온다 — 오류가 없으면 받지도 않는다.
 */
export function createSnapshotTransport(
  firebase: SnapshotFirebaseConfig
): ErrorReportTransport {
  let instance: Promise<ErrorSnapshotInstance> | null = null;
  return async ({ error, meta }) => {
    instance ??= import("@kwoncheulJin/error-snapshot").then(
      ({ initErrorSnapshot }) =>
        initErrorSnapshot({
          projectId: SNAPSHOT_PROJECT_ID,
          appPrefix: SNAPSHOT_APP_PREFIX,
          firebase,
          captureTarget: disableScreenshot,
          captureDelay: 0
        })
    );
    const record = await (await instance).capture(error, meta);
    return record.errorCode;
  };
}
