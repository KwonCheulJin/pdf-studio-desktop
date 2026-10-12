import type { DesktopPlatform } from "./desktop-platform";

let currentPlatform: DesktopPlatform | null = null;

/** 부팅 시 `app/providers`에서 한 번 부른다. */
export function setPlatform(platform: DesktopPlatform): void {
  currentPlatform = platform;
}

export function getPlatform(): DesktopPlatform {
  if (!currentPlatform) {
    throw new Error("DesktopPlatform이 주입되지 않았습니다.");
  }
  return currentPlatform;
}
