import { useCallback } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError
} from "@/renderer/shared/platform";
import {
  COMPARE_FILE_COUNT,
  COMPARE_INTAKE_MESSAGE
} from "../config/compare-files";
import {
  useCompareSessionStore,
  type CompareFile
} from "./compare-session-store";

interface UseCompareIntakeResult {
  /** 열기 다이얼로그로 고른다. 비교 세션에 넣었으면 `true` */
  pickCompareFiles: () => Promise<boolean>;
  /** 드롭으로 받은 경로를 넣는다. 비교 세션에 넣었으면 `true` */
  takeCompareFiles: (paths: string[]) => Promise<boolean>;
}

/**
 * 비교할 문서를 받아 비교 세션(A·B)에 넣는다. 2개를 넘으면 어느 둘인지 알 수 없어 넣지 않고 알린다.
 * 확장자·쪽수 확인은 파일 슬롯(다음 Step)에서 한다.
 */
export function useCompareIntake(): UseCompareIntakeResult {
  const setFiles = useCompareSessionStore((state) => state.setFiles);

  const takeCompareFiles = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return false;
      if (paths.length > COMPARE_FILE_COUNT) {
        toast.error(COMPARE_INTAKE_MESSAGE.TOO_MANY_TITLE, {
          description: COMPARE_INTAKE_MESSAGE.TOO_MANY_DESCRIPTION
        });
        return false;
      }
      const platform = getPlatform();
      const files = await Promise.all(
        paths.map(
          async (path): Promise<CompareFile> => ({
            path,
            name: await platform.fileStem(path)
          })
        )
      );
      setFiles(files);
      return true;
    },
    [setFiles]
  );

  const pickCompareFiles = useCallback(async () => {
    const platform = getPlatform();
    let paths: string[];
    try {
      paths = await platform.pickFiles();
    } catch (error) {
      const platformError = toPlatformError(error);
      platform.log({
        level: LOG_LEVEL.ERROR,
        message: `비교 파일 선택 다이얼로그 실패: [${platformError.code}] ${platformError.message}`
      });
      toast.error(COMPARE_INTAKE_MESSAGE.PICK_FAILED_TITLE, {
        description: getErrorMessage(platformError.code)
      });
      return false;
    }
    return takeCompareFiles(paths);
  }, [takeCompareFiles]);

  return { pickCompareFiles, takeCompareFiles };
}
