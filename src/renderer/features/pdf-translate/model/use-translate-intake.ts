import { useCallback } from "react";
import { toast } from "sonner";
import type { OpenedFile } from "@/renderer/shared/api/bindings";
import { FILE_EXTENSIONS } from "@/renderer/shared/constants/app";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  PlatformError,
  toPlatformError
} from "@/renderer/shared/platform";
import {
  TRANSLATE_FILE_COUNT,
  TRANSLATE_INTAKE_MESSAGE,
  translateFileMessage
} from "../config/translate-files";
import { useTranslateSessionStore } from "./translate-session-store";

interface UseTranslateIntakeResult {
  /** 열기 다이얼로그로 고른 파일을 넣는다. 넣었으면 `true` */
  pickTranslateFile: () => Promise<boolean>;
  /** 받은 경로(드롭)를 넣는다. 넣었으면 `true` */
  placeTranslateFiles: (paths: string[]) => Promise<boolean>;
}

/**
 * 번역은 PDF만 받는다. 확장자는 Rust가 열 수 있는 것(PDF·TIFF)만 허용 목록에 들어오므로
 * 여기서는 PDF인지만 본다(TIFF를 PDF로 바꾸는 일은 병합이 한다).
 */
function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(FILE_EXTENSIONS.PDF);
}

interface NotifyTranslateFailureParams {
  /** 토스트 제목 */
  title: string;
  error: PlatformError;
  /** 로그에만 남길 맥락(경로 등) */
  context: string;
}

/** 화면에는 코드의 문구를, 로그에는 플랫폼 `message`를 남긴다. */
function notifyTranslateFailure({
  title,
  error,
  context
}: NotifyTranslateFailureParams): void {
  getPlatform().log({
    level: LOG_LEVEL.ERROR,
    message: `${context}: [${error.code}] ${error.message}`
  });
  toast.error(title, { description: getErrorMessage(error.code) });
}

async function notifyOpenFailure(
  failure: Extract<OpenedFile, { status: "error" }>
): Promise<void> {
  const fileName = await getPlatform().fileStem(failure.sourcePath);
  notifyTranslateFailure({
    title: translateFileMessage.openFailedTitle(fileName),
    error: new PlatformError(failure.error),
    context: `번역 파일 열기 실패: ${failure.sourcePath}`
  });
}

/**
 * 번역할 문서를 받아 세션에 넣는다. 파일은 1개까지이고(2개 이상은 알리고 넣지 않는다),
 * PDF만 열어 이름·크기·쪽수를 읽는다. 받지 못한 파일은 알리고 세션은 그대로 둔다.
 */
export function useTranslateIntake(): UseTranslateIntakeResult {
  const setFile = useTranslateSessionStore((state) => state.setFile);

  const placeTranslateFiles = useCallback(
    async (paths: string[]) => {
      const [path] = paths;
      if (path === undefined) return false;
      if (paths.length > TRANSLATE_FILE_COUNT) {
        toast.error(TRANSLATE_INTAKE_MESSAGE.TOO_MANY_TITLE, {
          description: TRANSLATE_INTAKE_MESSAGE.TOO_MANY_DESCRIPTION
        });
        return false;
      }
      if (!isPdfPath(path)) {
        toast.error(
          translateFileMessage.notPdfTitle(await getPlatform().fileStem(path)),
          { description: TRANSLATE_INTAKE_MESSAGE.NOT_PDF_DESCRIPTION }
        );
        return false;
      }

      let openedFiles: OpenedFile[];
      try {
        openedFiles = await getPlatform().openFiles([path]);
      } catch (error) {
        notifyTranslateFailure({
          title: TRANSLATE_INTAKE_MESSAGE.OPEN_FAILED_TITLE,
          error: toPlatformError(error),
          context: `번역 파일 열기 요청 실패: ${path}`
        });
        return false;
      }

      // `openFiles`는 입력 순서대로 파일별 결과를 돌려준다.
      const [opened] = openedFiles;
      if (opened === undefined) return false;
      if (opened.status === "error") {
        await notifyOpenFailure(opened);
        return false;
      }
      setFile({
        path: opened.pdfPath,
        name: opened.displayName,
        sizeBytes: opened.sizeBytes,
        pageCount: opened.info.pageCount
      });
      return true;
    },
    [setFile]
  );

  const pickTranslateFile = useCallback(async () => {
    let paths: string[];
    try {
      paths = await getPlatform().pickFiles();
    } catch (error) {
      notifyTranslateFailure({
        title: TRANSLATE_INTAKE_MESSAGE.PICK_FAILED_TITLE,
        error: toPlatformError(error),
        context: "번역 파일 선택 다이얼로그 실패"
      });
      return false;
    }
    return placeTranslateFiles(paths);
  }, [placeTranslateFiles]);

  return { pickTranslateFile, placeTranslateFiles };
}
