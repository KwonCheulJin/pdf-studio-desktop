import type { FlatCard } from "./flatten-file-grid";
import { FLAT_CARD_TYPE } from "../config/flat-card";

/** 카드를 정렬 목록에서 구분하는 ID. 같은 파일이 여러 그룹으로 나뉘어도 겹치지 않는다. */
export function getCardSortId(card: FlatCard): string {
  return card.type === FLAT_CARD_TYPE.FILE ? card.groupId : card.page.id;
}

/** 스크린 리더가 읽는 카드 이름. 접힌 카드는 문서, 펼친 카드는 원본 쪽 번호 */
export function getCardLabel(card: FlatCard): string {
  return card.type === FLAT_CARD_TYPE.FILE
    ? `${card.file.name} 문서`
    : `${card.file.name} ${card.page.sourcePageIndex + 1}쪽`;
}

/** 카드 앞에 넣는다 = 그 카드의 첫 페이지 앞에 넣는다. */
function getCardFirstPageId(card: FlatCard): string {
  return card.type === FLAT_CARD_TYPE.FILE ? card.firstPageId : card.page.id;
}

interface GetInsertTargetPageIdParams {
  flatCards: FlatCard[];
  /** 이 순서의 카드 앞에 넣는다. 카드 수 이상이면 맨 끝 */
  index: number;
}

/** 병합 순서에서 이 페이지 앞에 넣는다. 맨 끝이면 `null` */
export function getInsertTargetPageId({
  flatCards,
  index
}: GetInsertTargetPageIdParams): string | null {
  const card = flatCards[index];
  return card ? getCardFirstPageId(card) : null;
}

interface FileCardMove {
  type: typeof FLAT_CARD_TYPE.FILE;
  fileId: string;
  targetPageId: string | null;
}

interface PageCardMove {
  type: typeof FLAT_CARD_TYPE.PAGE;
  pageId: string;
  targetPageId: string | null;
}

export type CardMove = FileCardMove | PageCardMove;

interface ResolveCardMoveParams {
  flatCards: FlatCard[];
  activeIndex: number;
  overIndex: number;
}

/**
 * 정렬 결과(끌던 카드가 `overIndex` 자리로 감)를 병합 순서 이동으로 바꾼다.
 * 앞으로 옮기면 놓인 카드 앞에, 뒤로 옮기면 놓인 카드 뒤(다음 카드 앞)에 들어간다.
 * 접힌 파일 카드를 같은 파일의 카드 앞에 놓는 것처럼 바뀌는 것이 없으면 `null`이다.
 */
export function resolveCardMove({
  flatCards,
  activeIndex,
  overIndex
}: ResolveCardMoveParams): CardMove | null {
  const activeCard = flatCards[activeIndex];
  if (!activeCard || activeIndex === overIndex) {
    return null;
  }
  const targetIndex = overIndex < activeIndex ? overIndex : overIndex + 1;
  const targetPageId = getInsertTargetPageId({
    flatCards,
    index: targetIndex
  });

  if (activeCard.type === FLAT_CARD_TYPE.PAGE) {
    return {
      type: FLAT_CARD_TYPE.PAGE,
      pageId: activeCard.page.id,
      targetPageId
    };
  }
  if (flatCards[targetIndex]?.file.id === activeCard.file.id) {
    return null;
  }
  return {
    type: FLAT_CARD_TYPE.FILE,
    fileId: activeCard.file.id,
    targetPageId
  };
}
