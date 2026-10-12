import { useCallback } from "react";
import {
  useMergeFiles,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import { isPrimaryModifierPressed } from "@/renderer/shared/lib/keyboard";
import { useSelectionStore } from "./selection-store";
import { SELECTION_TYPE } from "../config/selection-type";
import { FLAT_CARD_TYPE } from "../config/flat-card";
import type { FlatCard } from "../lib/flatten-file-grid";

interface CardClickEvent {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

interface CardClickParams {
  card: FlatCard;
  event: CardClickEvent;
}

interface SelectCardParams {
  card: FlatCard;
  isToggle: boolean;
  isRange: boolean;
  flatCards: FlatCard[];
  files: PdfDocument[];
}

function activePageIdsOf(file: PdfDocument): string[] {
  return file.pages.filter((page) => !page.isDeleted).map((page) => page.id);
}

/**
 * 접힌 문서 카드: 파일 선택 모드에서 파일과 그 페이지를 함께 고른다.
 * 범위는 화면에 보이는 문서 카드 순서로 잡는다.
 */
function selectFileCard({
  card,
  isToggle,
  isRange,
  flatCards
}: SelectCardParams) {
  const store = useSelectionStore.getState();
  const fileId = card.file.id;
  const wasFileMode = store.selectionType === SELECTION_TYPE.FILE;
  if (!wasFileMode) {
    store.setSelectionType(SELECTION_TYPE.FILE);
  }

  if (isRange && wasFileMode) {
    const fileCards = flatCards.filter(
      (flatCard) => flatCard.type === FLAT_CARD_TYPE.FILE
    );
    const fileIds = [...new Set(fileCards.map((flatCard) => flatCard.file.id))];
    store.selectRange(fileIds, fileId);
    const { selectedIds } = useSelectionStore.getState();
    store.ensurePagesSelected(
      fileCards
        .filter((flatCard) => selectedIds.has(flatCard.file.id))
        .flatMap((flatCard) => activePageIdsOf(flatCard.file))
    );
    return;
  }

  if (isToggle) {
    store.toggleFileWithPages(fileId, activePageIdsOf(card.file));
    return;
  }

  store.select(fileId);
  store.ensurePagesSelected(activePageIdsOf(card.file));
}

/**
 * 펼친 페이지 카드: 페이지 선택 모드에서 고른다.
 * 범위는 화면에 보이는 페이지 카드 순서로 잡고, 전체 선택처럼 삭제된 페이지는 넣지 않는다.
 */
function selectPageCard({
  card,
  isToggle,
  isRange,
  flatCards,
  files
}: SelectCardParams) {
  if (card.type !== FLAT_CARD_TYPE.PAGE) return;
  const store = useSelectionStore.getState();
  const pageId = card.page.id;
  const wasPageMode = store.selectionType === SELECTION_TYPE.PAGE;

  if (isRange && wasPageMode) {
    const pageIds = flatCards.flatMap((flatCard) =>
      flatCard.type === FLAT_CARD_TYPE.PAGE && !flatCard.page.isDeleted
        ? [flatCard.page.id]
        : []
    );
    store.selectRange(pageIds, pageId);
    return;
  }

  if (isToggle) {
    if (wasPageMode) {
      store.toggle(pageId);
    } else {
      store.switchToPageMode(
        files.map((file) => file.id),
        pageId
      );
    }
    return;
  }

  if (!wasPageMode) {
    store.setSelectionType(SELECTION_TYPE.PAGE);
  }
  store.select(pageId);
}

/**
 * 카드 본문 클릭 선택.
 * 클릭 = 단일 선택, ⌘(macOS)/Ctrl+클릭 = 추가·해제, Shift+클릭 = 기준점부터 범위.
 * 기준점은 마지막 단일·⌘ 클릭이다. 다른 모드(파일↔페이지) 카드를 Shift+클릭하면 단일 선택이 된다.
 */
export function useCardSelection(
  flatCards: FlatCard[]
): (params: CardClickParams) => void {
  const files = useMergeFiles();

  return useCallback(
    ({ card, event }: CardClickParams) => {
      const params: SelectCardParams = {
        card,
        isToggle: isPrimaryModifierPressed(event),
        isRange: event.shiftKey,
        flatCards,
        files
      };
      if (card.type === FLAT_CARD_TYPE.FILE) {
        selectFileCard(params);
      } else {
        selectPageCard(params);
      }
    },
    [flatCards, files]
  );
}
