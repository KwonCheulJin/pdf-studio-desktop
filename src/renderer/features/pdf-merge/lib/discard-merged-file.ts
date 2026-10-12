import { getPlatform, LOG_LEVEL } from "@/renderer/shared/platform";

/**
 * 병합 미리보기 결과(앱 임시 파일)를 지운다. 정리 작업이라 실패해도 화면 흐름을
 * 막지 않고 로그만 남긴다(세션 폴더는 앱 종료 때 비워진다).
 */
export async function discardMergedFile(path: string): Promise<void> {
  const platform = getPlatform();
  try {
    await platform.discardTemp(path);
  } catch (error) {
    platform.log({
      level: LOG_LEVEL.ERROR,
      message: `임시 병합 파일 삭제 실패: ${path} - ${String(error)}`
    });
  }
}
