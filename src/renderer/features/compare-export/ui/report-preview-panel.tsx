import { useId } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  EXPORT_PREVIEW,
  EXPORT_TEXT,
  exportMessage,
  PREVIEW_STATUS
} from "../config/export-report";
import type { ReportPreviewState } from "../model/use-report-preview";

const SHEET_NAV_ICON_SIZE = 14;

const SHEET_NAV_BUTTON_CLASS =
  "border-border bg-card text-foreground hover:bg-accent focus-visible:ring-ring flex size-6.5 items-center justify-center rounded-sm border transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:text-muted-foreground disabled:cursor-not-allowed disabled:hover:bg-card";

interface ReportPreviewPanelProps {
  preview: ReportPreviewState;
  onShowSheet: (sheetIndex: number) => void;
  /** 아래 안내(지금 필터를 따른다는 것) */
  note: string;
}

interface SheetMessageProps {
  children: string;
}

/** 그림 대신 보이는 안내. 종이는 두 테마 모두 흰색이라 글자는 종이 밖 면에 둔다. */
function SheetMessage({ children }: SheetMessageProps) {
  return (
    <div className="border-input bg-card-inset text-muted-foreground rounded-paper flex size-full items-center justify-center border border-dashed px-6 text-center text-xs/4.25">
      {children}
    </div>
  );
}

interface SheetViewProps {
  preview: ReportPreviewState;
}

function SheetView({ preview }: SheetViewProps) {
  switch (preview.status) {
    case PREVIEW_STATUS.READY:
      return (
        <img
          src={`${EXPORT_PREVIEW.PNG_DATA_URL_PREFIX}${preview.images[preview.sheetIndex] ?? ""}`}
          alt={exportMessage.previewImage(preview.sheetIndex + 1)}
          className="bg-paper rounded-paper shadow-paper size-full object-contain"
        />
      );
    case PREVIEW_STATUS.LOADING:
      return (
        <div className="bg-paper rounded-paper shadow-paper size-full p-2">
          <div className="bg-muted size-full animate-pulse rounded-xs" />
        </div>
      );
    case PREVIEW_STATUS.EMPTY:
      return <SheetMessage>{EXPORT_TEXT.PREVIEW_EMPTY}</SheetMessage>;
    case PREVIEW_STATUS.FAILED:
      return (
        <SheetMessage>
          {`${EXPORT_TEXT.PREVIEW_FAILED} ${preview.errorCode === null ? "" : getErrorMessage(preview.errorCode)}`}
        </SheetMessage>
      );
    default:
      return <SheetMessage>{EXPORT_TEXT.PREVIEW_COMPARE_ONLY}</SheetMessage>;
  }
}

/**
 * 오른쪽 미리보기(시안 5): "미리보기 1 / 6장" + 이전·다음 장, A4 가로 종이에 비교 PDF 장 그림, 아래 안내.
 * 넘기기는 받은 장(앞 몇 장) 안에서만 하고, 전체가 더 많으면 그 사실을 알린다.
 */
export function ReportPreviewPanel({
  preview,
  onShowSheet,
  note
}: ReportPreviewPanelProps) {
  const titleId = useId();
  const isReady = preview.status === PREVIEW_STATUS.READY;
  const lastIndex = preview.images.length - 1;
  return (
    <section
      aria-labelledby={titleId}
      className="bg-canvas flex min-w-0 flex-col gap-3 rounded-lg p-3.5"
    >
      <div className="flex items-center gap-2 text-xs/4">
        <h3 id={titleId} className="font-semibold">
          {EXPORT_TEXT.PREVIEW}
        </h3>
        {isReady && (
          <span className="text-muted-foreground font-mono">
            {exportMessage.sheetPosition({
              current: preview.sheetIndex + 1,
              total: preview.sheetCount
            })}
          </span>
        )}
        <span className="grow" />
        <button
          type="button"
          aria-label={EXPORT_TEXT.PREVIOUS_SHEET}
          disabled={!isReady || preview.sheetIndex <= 0}
          onClick={() => onShowSheet(preview.sheetIndex - 1)}
          className={SHEET_NAV_BUTTON_CLASS}
        >
          <ChevronLeft size={SHEET_NAV_ICON_SIZE} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={EXPORT_TEXT.NEXT_SHEET}
          disabled={!isReady || preview.sheetIndex >= lastIndex}
          onClick={() => onShowSheet(preview.sheetIndex + 1)}
          className={SHEET_NAV_BUTTON_CLASS}
        >
          <ChevronRight size={SHEET_NAV_ICON_SIZE} aria-hidden="true" />
        </button>
      </div>
      <div
        aria-busy={preview.status === PREVIEW_STATUS.LOADING}
        style={{ aspectRatio: EXPORT_PREVIEW.SHEET_ASPECT_RATIO }}
      >
        <SheetView preview={preview} />
      </div>
      {isReady && preview.images.length < preview.sheetCount && (
        <p className="text-muted-foreground text-xs/4.25">
          {exportMessage.previewLimit(preview.images.length)}
        </p>
      )}
      <p className="text-muted-foreground text-xs/4.25">{note}</p>
    </section>
  );
}
