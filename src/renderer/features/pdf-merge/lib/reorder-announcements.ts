import type {
  Announcements,
  ScreenReaderInstructions,
  UniqueIdentifier
} from "@dnd-kit/core";

/** 카드에 포커스가 가면 읽는 사용법 */
export const REORDER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "Space 또는 Enter로 카드를 집고, 방향키로 옮긴 뒤 Space 또는 Enter로 놓습니다. Esc를 누르면 취소합니다."
};

interface CreateReorderAnnouncementsParams {
  /** 정렬 순서대로 늘어선 카드 ID */
  sortIds: string[];
  /** 카드 ID → 읽을 이름 */
  labels: Map<string, string>;
}

/** 카드를 집고 옮기고 놓을 때 live region으로 읽을 문구 */
export function createReorderAnnouncements({
  sortIds,
  labels
}: CreateReorderAnnouncementsParams): Announcements {
  const total = sortIds.length;
  const labelOf = (id: UniqueIdentifier): string =>
    labels.get(String(id)) ?? String(id);
  const positionOf = (id: UniqueIdentifier): number =>
    sortIds.indexOf(String(id)) + 1;

  return {
    onDragStart: ({ active }) =>
      `${labelOf(active.id)} 카드를 집었습니다. 위치 ${positionOf(active.id)} / ${total}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${labelOf(active.id)} 카드가 위치 ${positionOf(over.id)} / ${total}에 있습니다.`
        : `${labelOf(active.id)} 카드가 놓을 수 있는 자리 밖에 있습니다.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${labelOf(active.id)} 카드를 위치 ${positionOf(over.id)} / ${total}에 놓았습니다.`
        : `${labelOf(active.id)} 카드를 놓을 수 있는 자리 밖에서 놓아 순서가 그대로입니다.`,
    onDragCancel: ({ active }) =>
      `이동을 취소했습니다. ${labelOf(active.id)} 카드는 원래 자리에 있습니다.`
  };
}
