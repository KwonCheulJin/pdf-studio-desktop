import { useEffect, useEffectEvent, useState } from "react";
import { useAddDroppedFiles } from "@/renderer/features/pdf-merge";
import {
  FILE_DROP_EVENT_TYPE,
  getPlatform,
  type FileDropEvent
} from "@/renderer/shared/platform";

interface UseDroppedFilesParams {
  /** 빈 작업 공간일 때만 받는다. 파일이 있으면 그리드가 받는다. */
  isEnabled: boolean;
}

interface UseDroppedFilesResult {
  isDragOver: boolean;
}

/** 빈 작업 공간에 창 밖에서 끌어온 파일을 받아 차례로 추가한다. */
export function useDroppedFiles({
  isEnabled
}: UseDroppedFilesParams): UseDroppedFilesResult {
  const [isDragOver, setIsDragOver] = useState(false);
  const addDroppedFiles = useAddDroppedFiles();

  const handleFileDrop = useEffectEvent((event: FileDropEvent) => {
    switch (event.type) {
      case FILE_DROP_EVENT_TYPE.ENTER:
      case FILE_DROP_EVENT_TYPE.OVER:
        setIsDragOver(true);
        return;
      case FILE_DROP_EVENT_TYPE.LEAVE:
        setIsDragOver(false);
        return;
      case FILE_DROP_EVENT_TYPE.DROP:
        setIsDragOver(false);
        void addDroppedFiles({ paths: event.paths, targetPageId: null });
    }
  });

  useEffect(() => {
    if (!isEnabled) return;
    return getPlatform().onFileDrop((event) => handleFileDrop(event));
  }, [isEnabled]);

  return { isDragOver: isEnabled && isDragOver };
}
