import { useState, useCallback } from "react";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import {
  useSelectionStore,
  useSelectedIds
} from "@/renderer/shared/model/selection-store";
import { SELECTION_TYPE } from "@/renderer/shared/constants/page-state";
import {
  createPdfDocument,
  type PdfDocument
} from "@/renderer/shared/model/pdf-document";

interface UseSelectedMergeResult {
  startSelectedMerge: () => Promise<void>;
  isSelectedMerging: boolean;
  selectedMergedDocument: PdfDocument | null;
  clearSelectedMerge: () => void;
}

/**
 * 선택된 파일만 병합하는 훅
 * - merge-store 상태를 변경하지 않아 전체 병합 뷰에 영향 없음
 * - ipcRenderer.invoke 반환값을 직접 사용하여 IPC 리스너 충돌 방지
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
    if (selectionType !== SELECTION_TYPE.FILE || selectedIds.size < 2) return;

    const selectedFileIds = new Set(
      [...selectedIds].filter((id) =>
        files.some((candidate) => candidate.id === id)
      )
    );

    if (selectedFileIds.size < 2) return;

    // 선택된 파일만 포함하도록 mergeOrder 필터링
    const filteredOrder = mergeOrder.filter((item) =>
      selectedFileIds.has(item.fileId)
    );

    if (filteredOrder.length === 0) return;

    // 파일 맵 및 페이지 인덱스 맵 구성
    const fileMap = new Map(files.map((f) => [f.id, f]));
    const pageIndexMap = new Map<string, number>();
    for (const file of files) {
      for (const page of file.pages) {
        pageIndexMap.set(page.id, page.sourcePageIndex);
      }
    }

    // FilePayload 배열 생성 (연속된 같은 파일 페이지 그룹화)
    const segments: { path: string; pages: number[] }[] = [];
    let currentSegment: { path: string; pages: number[] } | null = null;

    for (const item of filteredOrder) {
      const file = fileMap.get(item.fileId);
      if (!file) continue;
      const pageIndex = pageIndexMap.get(item.pageId);
      if (pageIndex === undefined) continue;

      if (currentSegment && currentSegment.path === file.path) {
        currentSegment.pages.push(pageIndex);
      } else {
        currentSegment = { path: file.path, pages: [pageIndex] };
        segments.push(currentSegment);
      }
    }

    if (segments.length === 0) return;

    setIsSelectedMerging(true);
    setSelectedMergedDocument(null);

    try {
      // invoke 반환값으로 결과 수신 (이벤트 리스너 불필요)
      const result = await ipcClient.merge.start({ files: segments });

      const mergedDocument = createPdfDocument(
        result.outputPath,
        result.totalPages
      );
      setSelectedMergedDocument(mergedDocument);
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
