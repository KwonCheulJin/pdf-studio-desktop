import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import {
  FILE_DROP_EVENT_TYPE,
  getPlatform,
  type FileDropEvent
} from "@/renderer/shared/platform";

interface UseTranslateFileDropParams {
  areaRef: RefObject<HTMLElement | null>;
  /** 창 어디에 놓든 불린다. */
  onDrop: (paths: string[]) => void;
}

/**
 * 창 밖에서 끌어온 파일을 받는다. 드롭 대상은 `document.elementFromPoint`로 판정한다
 * (좌표는 플랫폼이 CSS 픽셀로 바꿔 준다). 끄는 동안 파일이 `areaRef` 영역 위에 있으면 `true`.
 */
export function useTranslateFileDrop({
  areaRef,
  onDrop
}: UseTranslateFileDropParams): boolean {
  const [isOverArea, setIsOverArea] = useState(false);

  const isInsideArea = (point: { x: number; y: number }): boolean => {
    const target = document.elementFromPoint(point.x, point.y);
    return target !== null && (areaRef.current?.contains(target) ?? false);
  };

  const handleFileDrop = useEffectEvent((event: FileDropEvent) => {
    switch (event.type) {
      case FILE_DROP_EVENT_TYPE.ENTER:
      case FILE_DROP_EVENT_TYPE.OVER:
        setIsOverArea(isInsideArea(event.point));
        return;
      case FILE_DROP_EVENT_TYPE.LEAVE:
        setIsOverArea(false);
        return;
      case FILE_DROP_EVENT_TYPE.DROP:
        setIsOverArea(false);
        onDrop(event.paths);
    }
  });

  useEffect(
    () => getPlatform().onFileDrop((event) => handleFileDrop(event)),
    []
  );

  return isOverArea;
}
