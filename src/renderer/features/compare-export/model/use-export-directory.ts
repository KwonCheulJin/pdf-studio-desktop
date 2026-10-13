import { useCallback } from "react";
import { getPlatform, toPlatformError } from "@/renderer/shared/platform";
import { EXPORT_TEXT } from "../config/export-report";
import { notifyExportFailure } from "../lib/notify-export-failure";
import { useExportDirectoryStore } from "./export-directory-store";

interface UseExportDirectoryResult {
  /** 고른 내보내기 폴더. 아직 고르지 않았으면 `null` */
  directory: string | null;
  /** 폴더 다이얼로그를 연다(고른 폴더가 있으면 거기서 시작). 취소하면 그대로 둔다. */
  pickDirectory: () => Promise<void>;
}

/** 저장 위치(시안 5): 폴더 다이얼로그에서 고른 폴더. Rust가 그 폴더 바로 안에만 새 파일을 만든다. */
export function useExportDirectory(): UseExportDirectoryResult {
  const directory = useExportDirectoryStore((state) => state.directory);

  const pickDirectory = useCallback(async () => {
    const { directory: current, setDirectory } =
      useExportDirectoryStore.getState();
    try {
      const picked = await getPlatform().pickSaveDirectory({
        defaultDirectory: current
      });
      if (picked !== null) {
        setDirectory(picked);
      }
    } catch (error) {
      notifyExportFailure({
        title: EXPORT_TEXT.PICK_FAILED,
        error: toPlatformError(error),
        context: "내보내기 폴더 고르기 실패"
      });
    }
  }, []);

  return { directory, pickDirectory };
}
