import {
  createMockPlatform,
  createTauriPlatform,
  isTauriRuntime,
  setPlatform,
  trackRunningWork
} from "@/renderer/shared/platform";
import { createE2ePlatform } from "./e2e-platform";

/**
 * 부팅 시 한 번 부른다. Tauri 웹뷰에서는 Tauri 커맨드 구현을,
 * 그 밖(브라우저에서 띄운 Vite 개발 서버, E2E)에서는 메모리 안 가짜 구현을 주입한다.
 * E2E 시드·기록 훅은 개발 서버에서만 쓴다. 프로덕션 빌드에서 `import.meta.env.DEV`는
 * false로 바뀌므로 `createE2ePlatform`과 그 모듈은 번들에서 빠진다.
 * 어느 구현이든 진행 중인 작업을 세어 업데이트 재시작을 막을 수 있게 한다(`hasRunningWork`).
 */
export function providePlatform(): void {
  if (isTauriRuntime()) {
    setPlatform(trackRunningWork(createTauriPlatform()));
    return;
  }
  setPlatform(
    trackRunningWork(
      import.meta.env.DEV ? createE2ePlatform() : createMockPlatform()
    )
  );
}
