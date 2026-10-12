declare const __APP_VERSION__: string;

/** 오류 보고(error-snapshot) 앱 전용 Firebase 설정. 없으면 오류 보고가 꺼진다. `.env.example` 참고 */
interface ImportMetaEnv {
  readonly VITE_ERROR_SNAPSHOT_FIREBASE_API_KEY?: string;
  readonly VITE_ERROR_SNAPSHOT_FIREBASE_PROJECT_ID?: string;
  readonly VITE_ERROR_SNAPSHOT_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_ERROR_SNAPSHOT_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_ERROR_SNAPSHOT_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_ERROR_SNAPSHOT_FIREBASE_APP_ID?: string;
}
