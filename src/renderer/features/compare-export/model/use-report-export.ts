import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  ChangeKind,
  ErrorCode,
  ExportedFile
} from "@/renderer/shared/api/bindings";
import { reportError } from "@/renderer/shared/lib/error-report";
import {
  getPlatform,
  toPlatformError,
  type PlatformError
} from "@/renderer/shared/platform";
import {
  EXPORT_ERROR_CODE,
  EXPORT_FAILED_TITLE,
  EXPORT_FILE_KIND,
  EXPORT_TEXT,
  exportMessage,
  type ExportFileKind
} from "../config/export-report";
import {
  reportOptionsOf,
  selectedFileKinds,
  type ExportSettings
} from "../lib/export-settings";
import { notifyExportFailure } from "../lib/notify-export-failure";
import type { ExportComparison } from "./export-comparison";

const CANCELLED_CODE: ErrorCode = EXPORT_ERROR_CODE.CANCELLED;

interface ExportFilesParams {
  settings: ExportSettings;
  directory: string;
  fileNames: Record<ExportFileKind, string>;
}

interface ExportOneParams extends ExportFilesParams {
  kind: ExportFileKind;
}

interface ExportFailure {
  kind: ExportFileKind;
  error: PlatformError;
}

interface ExportOutcome {
  created: readonly ExportedFile[];
  failure: ExportFailure | null;
}

interface UseReportExportParams {
  comparison: ExportComparison;
  hiddenKinds: readonly ChangeKind[];
}

interface UseReportExportResult {
  isExporting: boolean;
  /**
   * 고른 파일을 차례로(비교 PDF → 주석 PDF) 만든다. 만든 파일은 토스트로 알리고, 실패하면 거기서 멈추고
   * 알린다(취소는 알리지 않는다). 모두 만들었으면 `true`다.
   */
  exportFiles: (params: ExportFilesParams) => Promise<boolean>;
  /** 만드는 중인 파일을 취소하고 남은 파일은 만들지 않는다. */
  cancelExport: () => void;
}

/** 내보내기 실행(계획서 P3-5 "끝나면 토스트"). 파일마다 작업 ID를 새로 만들어 `cancelJob`으로 멈춘다. */
export function useReportExport({
  comparison,
  hiddenKinds
}: UseReportExportParams): UseReportExportResult {
  const [isExporting, setIsExporting] = useState(false);
  const runningJobRef = useRef<string | null>(null);
  const isCancelledRef = useRef(false);

  const exportOne = useCallback(
    async ({
      kind,
      directory,
      fileNames,
      settings
    }: ExportOneParams): Promise<ExportedFile> => {
      const jobId = crypto.randomUUID();
      runningJobRef.current = jobId;
      const output = { directory, fileName: fileNames[kind] };
      const platform = getPlatform();
      if (kind === EXPORT_FILE_KIND.COMPARE) {
        return platform.exportComparePdf({
          jobId,
          result: comparison.result,
          before: comparison.before.path,
          after: comparison.after.path,
          options: reportOptionsOf({ settings, hiddenKinds }),
          output
        });
      }
      return platform.exportAnnotatedPdf({
        jobId,
        result: comparison.result,
        after: comparison.after.path,
        hiddenKinds: [...hiddenKinds],
        output
      });
    },
    [comparison, hiddenKinds]
  );

  const exportFiles = useCallback(
    async (params: ExportFilesParams) => {
      isCancelledRef.current = false;
      setIsExporting(true);
      const outcome = await selectedFileKinds(params.settings).reduce<
        Promise<ExportOutcome>
      >(
        async (previous, kind) => {
          const done = await previous;
          if (done.failure !== null || isCancelledRef.current) return done;
          try {
            const file = await exportOne({ ...params, kind });
            return { ...done, created: [...done.created, file] };
          } catch (error) {
            return {
              ...done,
              failure: { kind, error: toPlatformError(error) }
            };
          }
        },
        Promise.resolve({ created: [], failure: null })
      );
      runningJobRef.current = null;
      setIsExporting(false);

      // 취소한 뒤에 끝난 파일도 이미 만들어졌으므로 알린다.
      if (outcome.created.length > 0) {
        toast.success(exportMessage.created(outcome.created.length), {
          description: outcome.created.map((file) => file.fileName).join(", ")
        });
      }
      const { failure } = outcome;
      if (
        failure !== null &&
        failure.error.code !== CANCELLED_CODE &&
        !isCancelledRef.current
      ) {
        notifyExportFailure({
          title: EXPORT_FAILED_TITLE[failure.kind],
          error: failure.error,
          context: `리포트 내보내기 실패(${failure.kind}) ${params.directory}`
        });
        void reportError({
          error: failure.error,
          meta: { source: "compare-export", code: failure.error.code }
        });
      }
      return failure === null && !isCancelledRef.current;
    },
    [exportOne]
  );

  const cancelExport = useCallback(() => {
    isCancelledRef.current = true;
    const jobId = runningJobRef.current;
    if (jobId === null) return;
    getPlatform()
      .cancelJob(jobId)
      .catch((error: unknown) => {
        notifyExportFailure({
          title: EXPORT_TEXT.CANCEL_FAILED,
          error: toPlatformError(error),
          context: `리포트 내보내기 취소 실패 ${jobId}`
        });
      });
  }, []);

  return { isExporting, exportFiles, cancelExport };
}
