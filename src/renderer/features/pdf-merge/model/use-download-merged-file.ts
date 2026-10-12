import type { PdfDocument } from "@/renderer/entities/merge-plan";
import { getPlatform, toPlatformError } from "@/renderer/shared/platform";
import { notifyFailure } from "../lib/notify-failure";

interface DownloadResult {
  /** 저장했으면 `true`. 저장 다이얼로그를 취소했거나 실패하면 `false`(실패는 토스트로 알린다) */
  success: boolean;
}

export function useDownloadMergedFile() {
  const download = async (document: PdfDocument): Promise<DownloadResult> => {
    const platform = getPlatform();
    try {
      // 기본값: 현재 이름(사용자가 변경 가능). 병합 결과는 앱 임시 폴더에 있으므로
      // 처음 보일 폴더는 플랫폼이 정한다.
      const savePath = await platform.pickSavePath({
        fileName: document.name || "merged.pdf"
      });

      if (!savePath) {
        return { success: false };
      }

      await platform.copyFile({
        source: document.path,
        destination: savePath
      });
      return { success: true };
    } catch (error) {
      notifyFailure({
        title: "병합 결과를 저장하지 못했습니다.",
        error: toPlatformError(error),
        context: `병합 결과 저장 실패: ${document.path}`
      });
      return { success: false };
    }
  };

  return { download };
}
