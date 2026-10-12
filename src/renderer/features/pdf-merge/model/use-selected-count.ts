import { useMemo } from "react";
import { useMergeFiles } from "@/renderer/entities/merge-plan";
import { useSelectedIds, useSelectionType } from "./selection-store";
import { SELECTION_TYPE } from "../config/selection-type";

/**
 * 화면에 보일 선택 수. 파일 모드는 파일과 그 페이지를 함께 고르므로(`selectedIds`에 둘 다 있다)
 * 파일만 세고, 페이지 모드는 고른 페이지 수다.
 */
export function useSelectedCount(): number {
  const files = useMergeFiles();
  const selectionType = useSelectionType();
  const selectedIds = useSelectedIds();

  return useMemo(
    () =>
      selectionType === SELECTION_TYPE.FILE
        ? files.filter((file) => selectedIds.has(file.id)).length
        : selectedIds.size,
    [files, selectionType, selectedIds]
  );
}
