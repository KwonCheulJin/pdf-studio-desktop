import type { PdfDocument } from "@/renderer/entities/merge-plan";
import { getPlatform } from "@/renderer/shared/platform";

interface DownloadResult {
  success: boolean;
  error?: string;
}

export function useDownloadMergedFile() {
  const download = async (document: PdfDocument): Promise<DownloadResult> => {
    // 기본값: 현재 이름(사용자가 변경 가능). 병합 결과는 앱 임시 폴더에 있으므로
    // 처음 보일 폴더는 플랫폼이 정한다.
    const platform = getPlatform();
    const savePath = await platform.pickSavePath({
      fileName: document.name || "merged.pdf"
    });

    if (!savePath) {
      return { success: false };
    }

    try {
      await platform.copyFile({
        source: document.path,
        destination: savePath
      });
      return { success: true };
    } catch {
      return { success: false, error: "파일을 저장할 수 없습니다." };
    }
  };

  return { download };
}
