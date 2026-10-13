import type {
  ChangeKind,
  CompareReportOptions,
  CompareResult,
  ReportLayout
} from "@/renderer/shared/api/bindings";
import {
  EXPORT_FILE_KIND,
  EXPORT_FILE_KINDS,
  EXPORT_TEXT,
  exportMessage,
  PREVIEW_STATUS,
  REPORT_LAYOUT,
  type ExportFileKind,
  type PreviewStatus
} from "../config/export-report";

/** 모달에서 고른 것(시안 5 "받을 파일"과 비교 PDF 하위 옵션) */
export interface ExportSettings {
  files: Record<ExportFileKind, boolean>;
  layout: ReportLayout;
  isChangedOnly: boolean;
  isBoxDrawn: boolean;
}

/** 모달을 열 때마다 시작하는 값(시안 5: 비교 PDF · 나란히 · 차이 쪽만 · 색 상자) */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  files: {
    [EXPORT_FILE_KIND.COMPARE]: true,
    [EXPORT_FILE_KIND.ANNOTATED]: false
  },
  layout: REPORT_LAYOUT.SIDE_BY_SIDE,
  isChangedOnly: true,
  isBoxDrawn: true
};

interface ReportOptionsParams {
  settings: ExportSettings;
  /** 결과 화면 필터에서 끈 종류 */
  hiddenKinds: readonly ChangeKind[];
}

/** Rust로 보낼 비교 PDF 옵션 */
export function reportOptionsOf({
  settings,
  hiddenKinds
}: ReportOptionsParams): CompareReportOptions {
  return {
    layout: settings.layout,
    changedPagesOnly: settings.isChangedOnly,
    drawBoxes: settings.isBoxDrawn,
    hiddenKinds: [...hiddenKinds]
  };
}

/** 만들 파일 종류(만드는 순서) */
export function selectedFileKinds(settings: ExportSettings): ExportFileKind[] {
  return EXPORT_FILE_KINDS.filter((kind) => settings.files[kind]);
}

interface PreviewChangeParams {
  previous: ExportSettings;
  next: ExportSettings;
}

/** 미리보기(비교 PDF)를 다시 받아야 하나: 비교 PDF를 새로 켰거나 쪽 구성·차이 쪽만·색 상자가 바뀌었다. */
export function isPreviewChanged({
  previous,
  next
}: PreviewChangeParams): boolean {
  return (
    !previous.files[EXPORT_FILE_KIND.COMPARE] ||
    previous.layout !== next.layout ||
    previous.isChangedOnly !== next.isChangedOnly ||
    previous.isBoxDrawn !== next.isBoxDrawn
  );
}

interface LayoutRowCountParams {
  pagePairs: CompareResult["pagePairs"];
  layout: ReportLayout;
}

/** 차이 쪽만을 끈 장 수: 한쪽 배치는 그쪽 쪽이 없는 행(짝 없는 행)을 넣지 않는다(ADR 0001 §14). */
export function layoutRowCount({
  pagePairs,
  layout
}: LayoutRowCountParams): number {
  return pagePairs.filter(([before, after]) => {
    if (layout === REPORT_LAYOUT.A_ONLY) return before !== null;
    if (layout === REPORT_LAYOUT.B_ONLY) return after !== null;
    return true;
  }).length;
}

interface ExportReadinessParams {
  settings: ExportSettings;
  directory: string | null;
  previewStatus: PreviewStatus;
}

export interface ExportReadiness {
  /** 바닥 줄 문구: 막힌 이유 또는 "파일 N개를 만들어요" */
  message: string;
  isBlocked: boolean;
}

/** 바닥 줄(시안 5): 내보낼 수 없는 이유가 있으면 그 문구와 함께 막는다. */
export function exportReadinessOf({
  settings,
  directory,
  previewStatus
}: ExportReadinessParams): ExportReadiness {
  const fileCount = selectedFileKinds(settings).length;
  if (fileCount === 0) {
    return { message: EXPORT_TEXT.REASON_NO_FILE, isBlocked: true };
  }
  if (directory === null) {
    return { message: EXPORT_TEXT.REASON_NO_LOCATION, isBlocked: true };
  }
  if (
    settings.files[EXPORT_FILE_KIND.COMPARE] &&
    previewStatus === PREVIEW_STATUS.EMPTY
  ) {
    return { message: EXPORT_TEXT.REASON_EMPTY_REPORT, isBlocked: true };
  }
  return { message: exportMessage.fileCount(fileCount), isBlocked: false };
}
