import { useState, useCallback, useRef } from "react";
import type { FlatCard } from "@/renderer/shared/lib/flatten-file-grid";
import {
  FLAT_CARD_TYPE,
  type FlatCardType
} from "@/renderer/shared/constants/flat-card";

/**
 * 통합 드래그 상태
 */
interface UnifiedDragState {
  isDragging: boolean;
  draggedCardType: FlatCardType | null;
  draggedFileId: string | null;
  draggedPageId: string | null;
  draggedFlatIndex: number | null;
  dropTargetFlatIndex: number | null;
}

/**
 * 파일을 특정 위치에 삽입하기 위한 파라미터
 */
interface InsertFileAtPositionParams {
  fileId: string;
  targetPageId: string | null;
}

/**
 * mergeOrder 내 단일 페이지 이동 파라미터
 */
interface MovePageInMergeOrderParams {
  pageId: string;
  targetPageId: string | null;
}

export interface DragStartParams {
  cardType: FlatCardType;
  fileId: string;
  pageId?: string | null;
  flatIndex: number;
}

/**
 * useUnifiedDrag 훅의 매개변수
 */
interface UseUnifiedDragParams {
  flatCards: FlatCard[];
  onInsertFileAtPosition: (params: InsertFileAtPositionParams) => void;
  onMovePageInMergeOrder: (params: MovePageInMergeOrderParams) => void;
}

/**
 * useUnifiedDrag 훅의 반환값
 */
interface UseUnifiedDragResult {
  dragState: UnifiedDragState;
  handleCardDragStart: (
    event: React.DragEvent,
    params: DragStartParams
  ) => void;
  handleCardDragEnd: () => void;
  handleDropZoneDragOver: (
    event: React.DragEvent,
    targetFlatIndex: number
  ) => void;
  handleDropZoneDragLeave: () => void;
  handleDropZoneDrop: (event: React.DragEvent, targetFlatIndex: number) => void;
}

const initialDragState: UnifiedDragState = {
  isDragging: false,
  draggedCardType: null,
  draggedFileId: null,
  draggedPageId: null,
  draggedFlatIndex: null,
  dropTargetFlatIndex: null
};

/**
 * 파일과 페이지를 통합 처리하는 드래그 훅
 * - 파일 카드는 파일 단위 이동
 * - 펼쳐진 페이지 카드는 해당 페이지만 이동
 * - 드롭 위치의 페이지 ID를 기반으로 mergeOrder 업데이트
 */
export function useUnifiedDrag({
  flatCards,
  onInsertFileAtPosition,
  onMovePageInMergeOrder
}: UseUnifiedDragParams): UseUnifiedDragResult {
  const [dragState, setDragState] =
    useState<UnifiedDragState>(initialDragState);
  const dragLeaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleCardDragStart = useCallback(
    (event: React.DragEvent, params: DragStartParams) => {
      const { cardType, fileId, pageId = null, flatIndex } = params;

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", fileId);

      // 카드 좌상단이 마우스 커서에 위치하도록 설정
      const element = event.currentTarget as HTMLElement;
      event.dataTransfer.setDragImage(element, 0, 0);

      setDragState({
        isDragging: true,
        draggedCardType: cardType,
        draggedFileId: fileId,
        draggedPageId: pageId,
        draggedFlatIndex: flatIndex,
        dropTargetFlatIndex: null
      });
    },
    []
  );

  const handleCardDragEnd = useCallback(() => {
    setDragState(initialDragState);
  }, []);

  const handleDropZoneDragOver = useCallback(
    (event: React.DragEvent, targetFlatIndex: number) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      // 기존 dragLeave 타임아웃 취소
      if (dragLeaveTimeoutRef.current) {
        clearTimeout(dragLeaveTimeoutRef.current);
        dragLeaveTimeoutRef.current = null;
      }

      setDragState((prev) => {
        // 동일 인덱스면 업데이트 스킵
        if (prev.dropTargetFlatIndex === targetFlatIndex) {
          return prev;
        }
        return { ...prev, dropTargetFlatIndex: targetFlatIndex };
      });
    },
    []
  );

  const handleDropZoneDragLeave = useCallback(() => {
    // 즉시 null 설정 대신 딜레이 적용 (떨림 방지)
    dragLeaveTimeoutRef.current = setTimeout(() => {
      setDragState((prev) => ({
        ...prev,
        dropTargetFlatIndex: null
      }));
      dragLeaveTimeoutRef.current = null;
    }, 50);
  }, []);

  const handleDropZoneDrop = useCallback(
    (event: React.DragEvent, targetFlatIndex: number) => {
      event.preventDefault();

      const { draggedCardType, draggedFileId, draggedPageId } = dragState;

      if (!draggedCardType) {
        setDragState(initialDragState);
        return;
      }

      // 드롭 위치의 targetPageId 결정
      const targetCard = flatCards[targetFlatIndex];
      let targetPageId: string | null = null;

      if (!targetCard) {
        // 끝에 삽입
        targetPageId = null;
      } else if (targetCard.type === FLAT_CARD_TYPE.FILE) {
        // 접힌 파일 앞에 삽입 = 해당 그룹의 첫 페이지 앞
        targetPageId = targetCard.firstPageId;
      } else {
        // 펼친 페이지 앞에 삽입
        targetPageId = targetCard.page.id;
      }

      if (draggedCardType === FLAT_CARD_TYPE.FILE) {
        if (!draggedFileId) {
          setDragState(initialDragState);
          return;
        }

        // 같은 파일의 페이지 앞에 드롭하면 무시
        if (targetCard && targetCard.file.id === draggedFileId) {
          setDragState(initialDragState);
          return;
        }

        onInsertFileAtPosition({
          fileId: draggedFileId,
          targetPageId
        });
      } else if (draggedCardType === FLAT_CARD_TYPE.PAGE) {
        if (!draggedPageId) {
          setDragState(initialDragState);
          return;
        }

        onMovePageInMergeOrder({
          pageId: draggedPageId,
          targetPageId
        });
      }

      setDragState(initialDragState);
    },
    [dragState, flatCards, onInsertFileAtPosition, onMovePageInMergeOrder]
  );

  return {
    dragState,
    handleCardDragStart,
    handleCardDragEnd,
    handleDropZoneDragOver,
    handleDropZoneDragLeave,
    handleDropZoneDrop
  };
}
