import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import {
  FILE_DROP_EVENT_TYPE,
  getPlatform,
  type ClientPoint,
  type FileDropEvent
} from "@/renderer/shared/platform";
import { COMPARE_SLOTS, type CompareSlot } from "../config/compare-files";
import type { PlaceCompareFilesParams } from "./use-compare-intake";

interface UseSlotFileDropParams {
  slotRefs: Record<CompareSlot, RefObject<HTMLElement | null>>;
  /** 창 어디에 놓든 불린다. 슬롯 밖이면 `target`이 `null`이다. */
  onDrop: (drop: PlaceCompareFilesParams) => void;
}

/**
 * 창 밖에서 끌어온 파일을 비교 슬롯에 놓는다. 드롭 대상은 `document.elementFromPoint`로 판정한다
 * (좌표는 플랫폼이 CSS 픽셀로 바꿔 준다). 끄는 동안 파일이 올라가 있는 슬롯을 돌려준다(없으면 `null`).
 */
export function useSlotFileDrop({
  slotRefs,
  onDrop
}: UseSlotFileDropParams): CompareSlot | null {
  const [activeSlot, setActiveSlot] = useState<CompareSlot | null>(null);

  const findSlot = (point: ClientPoint): CompareSlot | null => {
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) return null;
    return (
      COMPARE_SLOTS.find((slot) => slotRefs[slot].current?.contains(target)) ??
      null
    );
  };

  const handleFileDrop = useEffectEvent((event: FileDropEvent) => {
    switch (event.type) {
      case FILE_DROP_EVENT_TYPE.ENTER:
      case FILE_DROP_EVENT_TYPE.OVER:
        setActiveSlot(findSlot(event.point));
        return;
      case FILE_DROP_EVENT_TYPE.LEAVE:
        setActiveSlot(null);
        return;
      case FILE_DROP_EVENT_TYPE.DROP:
        setActiveSlot(null);
        onDrop({ paths: event.paths, target: findSlot(event.point) });
    }
  });

  useEffect(
    () => getPlatform().onFileDrop((event) => handleFileDrop(event)),
    []
  );

  return activeSlot;
}
