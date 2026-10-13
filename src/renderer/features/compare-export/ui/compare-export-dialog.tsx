import { useId, useMemo, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import {
  CHANGE_KIND_LABEL,
  CHANGE_KINDS,
  type ChangeKind
} from "@/renderer/entities/comparison";
import { cn } from "@/renderer/shared/lib/utils";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger
} from "@/renderer/shared/ui";
import {
  EXPORT_FILE_KIND,
  EXPORT_TEXT,
  exportMessage,
  PREVIEW_STATUS
} from "../config/export-report";
import { exportFileNames } from "../lib/export-file-names";
import {
  DEFAULT_EXPORT_SETTINGS,
  exportReadinessOf,
  isPreviewChanged,
  layoutRowCount,
  selectedFileKinds,
  type ExportSettings
} from "../lib/export-settings";
import type { ExportComparison } from "../model/export-comparison";
import { useExportDirectory } from "../model/use-export-directory";
import { useReportExport } from "../model/use-report-export";
import {
  useReportPreview,
  type ReportPreviewState
} from "../model/use-report-preview";
import { ExportFileOptions } from "./export-file-options";
import { ExportLocationField } from "./export-location-field";
import { ReportPreviewPanel } from "./report-preview-panel";

const OPEN_ICON_SIZE = 16;
const CLOSE_ICON_SIZE = 18;
const EXPORT_ICON_SIZE = 16;

interface CompareExportDialogProps {
  comparison: ExportComparison;
  /** 결과 화면 필터에서 끈 종류. 비교 PDF·주석 PDF 모두 이 종류를 빼고 만든다. */
  hiddenKinds: readonly ChangeKind[];
  /** 결과 화면에서 "확인 필요"를 숨겼나. 확인 필요는 종류가 아니라 내보낼 때 숨기지 않으므로 알린다. */
  isReviewHidden: boolean;
}

/** 미리보기가 알려 준 장 수. 받는 중이거나 그리지 못했으면 모른다(`null`). */
function knownSheetCount(preview: ReportPreviewState): number | null {
  if (preview.status === PREVIEW_STATUS.READY) return preview.sheetCount;
  if (preview.status === PREVIEW_STATUS.EMPTY) return 0;
  return null;
}

/**
 * 결과 화면 머리의 "내보내기"와 그 모달(계획서 P3-5, 시안 5). 모달은 최대 1040px, 왼쪽 받을 파일·저장
 * 위치 | 오른쪽 360px 미리보기, 바닥 이유 문구 / 취소 / 내보내기다. 열 때마다 시안의 기본값으로 시작하고,
 * 비교 PDF 옵션이 바뀌면 미리보기를 다시 받는다. 닫으면(취소·✕·Esc) 내보내는 중인 파일도 취소한다.
 */
export function CompareExportDialog({
  comparison,
  hiddenKinds,
  isReviewHidden
}: CompareExportDialogProps) {
  const messageId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<ExportSettings>(
    DEFAULT_EXPORT_SETTINGS
  );
  const { preview, requestPreview, stopPreview, showSheet } = useReportPreview({
    comparison,
    hiddenKinds
  });
  const { directory, pickDirectory } = useExportDirectory();
  const { isExporting, exportFiles, cancelExport } = useReportExport({
    comparison,
    hiddenKinds
  });
  const fileNames = useMemo(
    () =>
      exportFileNames({
        beforeName: comparison.before.name,
        afterName: comparison.after.name
      }),
    [comparison]
  );

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setSettings(DEFAULT_EXPORT_SETTINGS);
      void requestPreview(DEFAULT_EXPORT_SETTINGS);
    } else {
      cancelExport();
      stopPreview();
    }
    setIsOpen(open);
  };

  const handleSettingsChange = (next: ExportSettings) => {
    setSettings(next);
    if (!next.files[EXPORT_FILE_KIND.COMPARE]) {
      stopPreview();
    } else if (isPreviewChanged({ previous: settings, next })) {
      void requestPreview(next);
    }
  };

  const handleExport = async () => {
    if (directory === null) return;
    const isComplete = await exportFiles({ settings, directory, fileNames });
    if (isComplete) {
      stopPreview();
      setIsOpen(false);
    }
  };

  const readiness = exportReadinessOf({
    settings,
    directory,
    previewStatus: preview.status
  });
  const pageChange =
    settings.files[EXPORT_FILE_KIND.COMPARE] && settings.isChangedOnly
      ? exportMessage.pageChange({
          all: layoutRowCount({
            pagePairs: comparison.result.pagePairs,
            layout: settings.layout
          }),
          changed: knownSheetCount(preview)
        })
      : "";
  const hiddenLabels = CHANGE_KINDS.filter((kind) =>
    hiddenKinds.includes(kind)
  ).map((kind) => CHANGE_KIND_LABEL[kind]);
  const note = isReviewHidden
    ? `${exportMessage.filterNote(hiddenLabels)} ${EXPORT_TEXT.REVIEW_NOT_HIDDEN}`
    : exportMessage.filterNote(hiddenLabels);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="h-8.5 gap-1.5 rounded-md px-3.5 font-medium">
          <Download size={OPEN_ICON_SIZE} aria-hidden="true" />
          {EXPORT_TEXT.OPEN}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="bg-card flex max-h-[calc(100%-3rem)] max-w-[calc(100%-3rem)] flex-col gap-0 overflow-y-auto rounded-xl border-0 p-0 text-sm/5.25 shadow-xl sm:max-w-260"
      >
        <div className="flex items-start gap-4 px-7 pt-5.5 pb-3.5">
          <div className="min-w-0 grow">
            <DialogTitle className="text-lg/6.5 font-semibold">
              {EXPORT_TEXT.TITLE}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs/4.25">
              {EXPORT_TEXT.SUBTITLE}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label={EXPORT_TEXT.CLOSE}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <X size={CLOSE_ICON_SIZE} aria-hidden="true" />
          </DialogClose>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-6 px-7 pb-5">
          <div className="flex min-w-0 flex-col gap-5">
            <ExportFileOptions
              settings={settings}
              onChange={handleSettingsChange}
              pageChange={pageChange}
            />
            <ExportLocationField
              directory={directory}
              fileNames={selectedFileKinds(settings).map(
                (kind) => fileNames[kind]
              )}
              onPick={() => void pickDirectory()}
              isDisabled={isExporting}
            />
          </div>
          <ReportPreviewPanel
            preview={preview}
            onShowSheet={showSheet}
            note={note}
          />
        </div>

        <div className="border-border flex flex-wrap items-center gap-3 border-t px-7 pt-3.5 pb-5.5">
          <p
            id={messageId}
            className={cn(
              "text-[13px]",
              readiness.isBlocked ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {readiness.message}
          </p>
          <span className="grow" />
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="bg-card h-10.5 rounded-md px-4.5 font-normal"
          >
            {EXPORT_TEXT.CANCEL}
          </Button>
          <Button
            disabled={readiness.isBlocked || isExporting}
            aria-describedby={messageId}
            onClick={() => void handleExport()}
            className="h-10 rounded-md px-5 font-semibold"
          >
            {isExporting ? (
              <Loader2
                size={EXPORT_ICON_SIZE}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Download size={EXPORT_ICON_SIZE} aria-hidden="true" />
            )}
            {isExporting ? EXPORT_TEXT.EXPORTING : EXPORT_TEXT.OPEN}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
