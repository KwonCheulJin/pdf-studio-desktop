import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import {
  FILE_DROP_EVENT_TYPE,
  getPlatform,
  type ClientPoint,
  type FileDropEvent
} from "@/renderer/shared/platform";
import { HOME_CARDS, type HomeCard } from "../config/home-card";

export interface CardFileDrop {
  card: HomeCard;
  paths: string[];
}

interface UseCardFileDropParams {
  cardRefs: Record<HomeCard, RefObject<HTMLElement | null>>;
  /** 카드 위에 놓았을 때만 불린다. 카드 밖에 놓은 파일은 받지 않는다. */
  onDrop: (drop: CardFileDrop) => void;
}

/**
 * 창 밖에서 끌어온 파일을 홈 카드 위에 놓는다. 드롭 대상은 `document.elementFromPoint`로 판정한다.
 * 끄는 동안 파일이 올라가 있는 카드를 돌려준다(없으면 `null`).
 */
export function useCardFileDrop({
  cardRefs,
  onDrop
}: UseCardFileDropParams): HomeCard | null {
  const [activeCard, setActiveCard] = useState<HomeCard | null>(null);

  const findCard = (point: ClientPoint): HomeCard | null => {
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) return null;
    return (
      HOME_CARDS.find((card) => cardRefs[card].current?.contains(target)) ??
      null
    );
  };

  const handleFileDrop = useEffectEvent((event: FileDropEvent) => {
    switch (event.type) {
      case FILE_DROP_EVENT_TYPE.ENTER:
      case FILE_DROP_EVENT_TYPE.OVER:
        setActiveCard(findCard(event.point));
        return;
      case FILE_DROP_EVENT_TYPE.LEAVE:
        setActiveCard(null);
        return;
      case FILE_DROP_EVENT_TYPE.DROP: {
        setActiveCard(null);
        const card = findCard(event.point);
        if (card) onDrop({ card, paths: event.paths });
      }
    }
  });

  useEffect(
    () => getPlatform().onFileDrop((event) => handleFileDrop(event)),
    []
  );

  return activeCard;
}
