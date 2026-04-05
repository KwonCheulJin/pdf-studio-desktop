import { initErrorSnapshot } from "@kwoncheulJin/error-snapshot";
import type { ErrorSnapshotInstance } from "@kwoncheulJin/error-snapshot";

let instance: ErrorSnapshotInstance | null = null;

/**
 * Error Snapshot 싱글턴 인스턴스 반환
 * - projectId: "pdf-studio" (대시보드에서 프로젝트별 필터링용)
 * - appPrefix: "PDF" (에러 코드 형식: PDF-20260401-1423-A3F2)
 */
export function getErrorSnapshot(): ErrorSnapshotInstance {
  if (!instance) {
    instance = initErrorSnapshot({
      projectId: "pdf-studio",
      appPrefix: "PDF",
      // firebase 설정은 생략 → 라이브러리 기본 Firebase 프로젝트 사용
    });

    // 전역 에러 핸들러 등록 (window.onerror, unhandledrejection)
    instance.attachGlobalHandlers();
  }

  return instance;
}
