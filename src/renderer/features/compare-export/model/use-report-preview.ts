import { useCallback, useRef, useState } from "react";
import type { ChangeKind, ErrorCode } from "@/renderer/shared/api/bindings";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError,
  type PlatformErrorCode
} from "@/renderer/shared/platform";
import {
  EXPORT_ERROR_CODE,
  EXPORT_PREVIEW,
  PREVIEW_STATUS,
  type PreviewStatus
} from "../config/export-report";
import { reportOptionsOf, type ExportSettings } from "../lib/export-settings";
import type { ExportComparison } from "./export-comparison";

export interface ReportPreviewState {
  status: PreviewStatus;
  /** 같은 옵션으로 내보낼 때의 전체 장 수(`READY`·`EMPTY`일 때만 맞는 값) */
  sheetCount: number;
  /** 첫 장부터 받은 장의 PNG(base64) */
  images: readonly string[];
  /** 지금 보이는 장(0부터). 받은 장 안에서만 넘긴다. */
  sheetIndex: number;
  /** `FAILED`일 때 오류 코드 */
  errorCode: PlatformErrorCode | null;
}

const OFF_PREVIEW: ReportPreviewState = {
  status: PREVIEW_STATUS.OFF,
  sheetCount: 0,
  images: [],
  sheetIndex: 0,
  errorCode: null
};

const EMPTY_REPORT_CODE: ErrorCode = EXPORT_ERROR_CODE.EMPTY_REPORT;

interface UseReportPreviewParams {
  comparison: ExportComparison;
  hiddenKinds: readonly ChangeKind[];
}

interface UseReportPreviewResult {
  preview: ReportPreviewState;
  /** 이 설정으로 미리보기를 다시 받는다. 앞서 보낸 요청의 응답은 늦게 와도 버린다. */
  requestPreview: (settings: ExportSettings) => Promise<void>;
  /** 미리보기를 끈다(비교 PDF를 고르지 않음). 받는 중인 응답도 버린다. */
  stopPreview: () => void;
  /** 받은 장 안에서 `sheetIndex`(0부터)로 넘긴다. */
  showSheet: (sheetIndex: number) => void;
}

/**
 * 비교 PDF 미리보기(계획서 P3-5 "첫 장부터 넘겨 보기, 지금 필터를 그대로"). 옵션이 바뀔 때마다 Rust에서 앞 몇
 * 장을 다시 받고 첫 장부터 보인다. 빠르게 바꾸면 요청이 겹치므로 요청마다 번호를 매겨 마지막 요청의 응답만
 * 쓴다(늦게 온 앞 요청의 응답이 새 미리보기를 덮지 않는다).
 */
export function useReportPreview({
  comparison,
  hiddenKinds
}: UseReportPreviewParams): UseReportPreviewResult {
  const [preview, setPreview] = useState<ReportPreviewState>(OFF_PREVIEW);
  const latestRequestRef = useRef(0);

  const requestPreview = useCallback(
    async (settings: ExportSettings) => {
      latestRequestRef.current += 1;
      const requestId = latestRequestRef.current;
      const isLatest = () => requestId === latestRequestRef.current;
      setPreview({ ...OFF_PREVIEW, status: PREVIEW_STATUS.LOADING });
      try {
        const received = await getPlatform().previewCompareReport({
          result: comparison.result,
          before: comparison.before.path,
          after: comparison.after.path,
          options: reportOptionsOf({ settings, hiddenKinds }),
          widthPx: EXPORT_PREVIEW.WIDTH_PX
        });
        if (!isLatest()) return;
        setPreview({
          ...OFF_PREVIEW,
          status: PREVIEW_STATUS.READY,
          sheetCount: received.sheetCount,
          images: received.images
        });
      } catch (error) {
        if (!isLatest()) return;
        const platformError = toPlatformError(error);
        if (platformError.code === EMPTY_REPORT_CODE) {
          setPreview({ ...OFF_PREVIEW, status: PREVIEW_STATUS.EMPTY });
          return;
        }
        getPlatform().log({
          level: LOG_LEVEL.ERROR,
          message: `리포트 미리보기 실패: [${platformError.code}] ${platformError.message}`
        });
        setPreview({
          ...OFF_PREVIEW,
          status: PREVIEW_STATUS.FAILED,
          errorCode: platformError.code
        });
      }
    },
    [comparison, hiddenKinds]
  );

  const stopPreview = useCallback(() => {
    latestRequestRef.current += 1;
    setPreview(OFF_PREVIEW);
  }, []);

  const showSheet = useCallback((sheetIndex: number) => {
    setPreview((current) => ({
      ...current,
      sheetIndex: Math.min(
        Math.max(sheetIndex, 0),
        Math.max(current.images.length - 1, 0)
      )
    }));
  }, []);

  return { preview, requestPreview, stopPreview, showSheet };
}
