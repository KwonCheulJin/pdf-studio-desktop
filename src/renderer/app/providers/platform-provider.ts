import {
  createMockPlatform,
  createTauriPlatform,
  isTauriRuntime,
  setPlatform
} from "@/renderer/shared/platform";

/**
 * 부팅 시 한 번 부른다. Tauri 웹뷰에서는 Tauri 커맨드 구현을,
 * 그 밖(브라우저에서 띄운 Vite 개발 서버, E2E)에서는 메모리 안 가짜 구현을 주입한다.
 */
export function providePlatform(): void {
  setPlatform(isTauriRuntime() ? createTauriPlatform() : createMockPlatform());
}
