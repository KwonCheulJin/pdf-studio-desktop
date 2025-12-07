import { ipcClient } from "../lib/ipc-client";
import type { PdfDocument } from "../model/pdf-document";

interface DownloadResult {
  success: boolean;
  error?: string;
}

export function useDownloadMergedFile() {
  const download = async (document: PdfDocument): Promise<DownloadResult> => {
    // 기본값: 원본과 동일 폴더 + 현재 이름(사용자가 변경 가능)
    const sourcePath = document.path ?? "";
    const lastSlashIndex = sourcePath.lastIndexOf("/");
    const baseDir = lastSlashIndex !== -1 ? sourcePath.slice(0, lastSlashIndex + 1) : "";
    const suggestedName = document.name || "merged.pdf";
    const defaultPath = `${baseDir}${suggestedName}`;

    const savePath = await ipcClient.dialog.save({
      defaultPath
    });

    if (!savePath) {
      return { success: false };
    }

    try {
      await ipcClient.file.copy({
        sourcePath: defaultPath,
        destinationPath: savePath
      });
      return { success: true };
    } catch {
      return { success: false, error: "파일을 저장할 수 없습니다." };
    }
  };

  return { download };
}
