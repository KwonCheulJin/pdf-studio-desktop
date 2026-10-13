import type { DesktopPlatform } from "./desktop-platform";

/** 끝나지 않은 작업 호출 수 */
let runningCount = 0;

async function track<T>(work: () => Promise<T>): Promise<T> {
  runningCount += 1;
  try {
    return await work();
  } finally {
    runningCount -= 1;
  }
}

/**
 * 앱을 다시 시작하면 잃는 작업 호출(병합·비교·내보내기·병합 결과 저장)을 센다.
 * 부팅 때 `app/providers`가 주입할 플랫폼을 한 번 감싼다.
 */
export function trackRunningWork(platform: DesktopPlatform): DesktopPlatform {
  return {
    ...platform,
    mergePdfs: (params) => track(() => platform.mergePdfs(params)),
    comparePdfs: (params) => track(() => platform.comparePdfs(params)),
    exportComparePdf: (request) =>
      track(() => platform.exportComparePdf(request)),
    exportAnnotatedPdf: (request) =>
      track(() => platform.exportAnnotatedPdf(request)),
    copyFile: (params) => track(() => platform.copyFile(params))
  };
}

/** 병합·비교·내보내기·저장 중 끝나지 않은 것이 있는지 */
export function hasRunningWork(): boolean {
  return runningCount > 0;
}
