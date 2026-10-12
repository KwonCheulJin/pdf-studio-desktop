import { useState, useCallback } from "react";
import {
  useMergeStore,
  createPdfDocument,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import {
  getPlatform,
  MERGE_OUTPUT_KIND,
  toPlatformError
} from "@/renderer/shared/platform";
import { useSelectionStore, useSelectedIds } from "./selection-store";
import { SELECTION_TYPE } from "../config/selection-type";
import { buildMergeSources } from "../lib/build-merge-request";
import { notifyFailure } from "../lib/notify-failure";

interface UseSelectedMergeResult {
  /** 병합 결과를 받았으면 `true`. 병합할 것이 없거나 실패하면 `false`(실패는 토스트로 알린다) */
  startSelectedMerge: () => Promise<boolean>;
  isSelectedMerging: boolean;
  selectedMergedDocument: PdfDocument | null;
  clearSelectedMerge: () => void;
}

/**
 * 선택된 파일만 병합하는 훅
 * - merge-store 상태를 변경하지 않아 전체 병합 뷰에 영향 없음
 * - 진행률을 받지 않고 병합 결과(반환값)만 사용
 * - 실패는 짧은 실패로 보고 토스트로 알린다
 */
export function useSelectedMerge(): UseSelectedMergeResult {
  const [isSelectedMerging, setIsSelectedMerging] = useState(false);
  const [selectedMergedDocument, setSelectedMergedDocument] =
    useState<PdfDocument | null>(null);

  const files = useMergeStore((state) => state.files);
  const mergeOrder = useMergeStore((state) => state.mergeOrder);
  const selectedIds = useSelectedIds();
  const selectionType = useSelectionStore((state) => state.selectionType);

  const startSelectedMerge = useCallback(async () => {
    if (selectedIds.size < 2) return false;

    let filteredOrder: typeof mergeOrder;

    if (selectionType === SELECTION_TYPE.FILE) {
      const selectedFileIds = new Set(
        [...selectedIds].filter((id) =>
          files.some((candidate) => candidate.id === id)
        )
      );
      if (selectedFileIds.size < 2) return false;
      filteredOrder = mergeOrder.filter((item) =>
        selectedFileIds.has(item.fileId)
      );
    } else {
      // PAGE 모드: 선택된 페이지 ID 기준으로 필터링
      filteredOrder = mergeOrder.filter((item) => selectedIds.has(item.pageId));
    }

    if (filteredOrder.length === 0) return false;

    // 병합 소스 생성 (연속된 같은 파일 페이지 그룹화)
    const sources = buildMergeSources({ files, mergeOrder: filteredOrder });

    if (sources.length === 0) return false;

    setIsSelectedMerging(true);
    setSelectedMergedDocument(null);

    try {
      const result = await getPlatform().mergePdfs({
        request: {
          jobId: crypto.randomUUID(),
          sources,
          output: { kind: MERGE_OUTPUT_KIND.TEMP }
        }
      });

      const mergedDocument = createPdfDocument(
        result.outputPath,
        result.pageCount
      );
      setSelectedMergedDocument(mergedDocument);
      return true;
    } catch (error) {
      notifyFailure({
        title: "선택한 항목을 병합하지 못했습니다.",
        error: toPlatformError(error),
        context: "선택 병합 실패"
      });
      return false;
    } finally {
      setIsSelectedMerging(false);
    }
  }, [files, mergeOrder, selectedIds, selectionType]);

  const clearSelectedMerge = useCallback(() => {
    setSelectedMergedDocument(null);
  }, []);

  return {
    startSelectedMerge,
    isSelectedMerging,
    selectedMergedDocument,
    clearSelectedMerge
  };
}
