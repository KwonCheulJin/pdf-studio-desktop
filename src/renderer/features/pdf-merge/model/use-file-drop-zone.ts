import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import {
  FILE_DROP_EVENT_TYPE,
  getPlatform,
  type ClientPoint,
  type FileDropDropEvent,
  type FileDropEvent
} from "@/renderer/shared/platform";
import { getFileBaseName } from "@/renderer/shared/lib/file-utils";
import type { GridPosition } from "@/renderer/shared/lib/layout-calculator";
import type { FlatCard } from "../lib/flatten-file-grid";
import { getInsertTargetPageId } from "../lib/card-move";
import { useAddDroppedFiles } from "./use-add-files";

export interface UploadingFile {
  id: string;
  name: string;
  insertIndex: number;
}

interface UseFileDropZoneParams {
  /** 그리드 컨테이너 ref */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 그리드 컨테이너 기준 좌표에 놓으면 몇 번째 카드 앞에 들어가는지 */
  resolveDropIndex: (point: GridPosition) => number;
  flatCards: FlatCard[];
}

interface UseFileDropZoneResult {
  /** 끌고 있는 파일이 들어갈 자리. 그리드 밖이거나 끌고 있지 않으면 `null` */
  activeDropIndex: number | null;
  /** 드롭한 파일을 여는 동안 그리드에 보이는 자리표시 */
  uploadingFiles: UploadingFile[];
}

/**
 * 창 밖에서 끌어온 파일을 그리드의 놓은 자리에 넣는다.
 * 드롭 대상은 `document.elementFromPoint`로 판정한다. 그리드 위면 좌표로 계산한 자리,
 * 그 밖(툴바, 그리드 아래 빈 곳)이면 맨 끝이다.
 */
export function useFileDropZone({
  containerRef,
  resolveDropIndex,
  flatCards
}: UseFileDropZoneParams): UseFileDropZoneResult {
  const [activeDropIndex, setActiveDropIndex] = useState<number | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const addDroppedFiles = useAddDroppedFiles();

  const findDropIndex = (point: ClientPoint): number | null => {
    const container = containerRef.current;
    const target = document.elementFromPoint(point.x, point.y);
    if (!container || !target || !container.contains(target)) {
      return null;
    }
    const rect = container.getBoundingClientRect();
    return resolveDropIndex({ x: point.x - rect.left, y: point.y - rect.top });
  };

  const insertDroppedFiles = async ({
    paths,
    point
  }: FileDropDropEvent): Promise<void> => {
    const index = findDropIndex(point) ?? flatCards.length;
    const placeholders = paths.map(
      (path): UploadingFile => ({
        id: crypto.randomUUID(),
        name: getFileBaseName(path),
        insertIndex: index
      })
    );
    const placeholderIds = new Set<string>(
      placeholders.map((placeholder) => placeholder.id)
    );
    setUploadingFiles((current) => [...current, ...placeholders]);
    try {
      await addDroppedFiles({
        paths,
        targetPageId: getInsertTargetPageId({ flatCards, index })
      });
    } finally {
      setUploadingFiles((current) =>
        current.filter((file) => !placeholderIds.has(file.id))
      );
    }
  };

  const handleFileDrop = useEffectEvent((event: FileDropEvent) => {
    switch (event.type) {
      case FILE_DROP_EVENT_TYPE.ENTER:
      case FILE_DROP_EVENT_TYPE.OVER:
        setActiveDropIndex(findDropIndex(event.point));
        return;
      case FILE_DROP_EVENT_TYPE.LEAVE:
        setActiveDropIndex(null);
        return;
      case FILE_DROP_EVENT_TYPE.DROP:
        setActiveDropIndex(null);
        void insertDroppedFiles(event);
    }
  });

  useEffect(
    () => getPlatform().onFileDrop((event) => handleFileDrop(event)),
    []
  );

  return { activeDropIndex, uploadingFiles };
}
