import { useState, useCallback, useRef } from "react";
import type { FlatCard } from "@/renderer/shared/lib/flatten-file-grid";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";
import { FLAT_CARD_TYPE } from "@/renderer/shared/constants/flat-card";

/**
 * 통합 드래그 상태
 */
interface UnifiedDragState {
  isDragging: boolean;
  draggedFileId: string | null;
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
 * useUnifiedDrag 훅의 매개변수
 */
interface UseUnifiedDragParams {
  flatCards: FlatCard[];
  files: PdfDocument[];
  onInsertFileAtPosition: (params: InsertFileAtPositionParams) => void;
}

/**
 * useUnifiedDrag 훅의 반환값
 */
interface UseUnifiedDragResult {
  dragState: UnifiedDragState;
  handleCardDragStart: (
    event: React.DragEvent,
    fileId: string,
    flatIndex: number
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
  draggedFileId: null,
  draggedFlatIndex: null,
  dropTargetFlatIndex: null
};

/**
 * 파일과 페이지를 통합 처리하는 드래그 훅
 * - 어떤 카드를 드래그하든 해당 파일 전체가 이동
 * - 드롭 위치의 페이지 ID를 기반으로 insertFileAtPosition 호출
 */
export function useUnifiedDrag({
  flatCards,
  files,
  onInsertFileAtPosition
}: UseUnifiedDragParams): UseUnifiedDragResult {
  const [dragState, setDragState] =
    useState<UnifiedDragState>(initialDragState);
  const dragLeaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleCardDragStart = useCallback(
    (event: React.DragEvent, fileId: string, flatIndex: number) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", fileId);

      // 카드 좌상단이 마우스 커서에 위치하도록 설정
      const element = event.currentTarget as HTMLElement;
      event.dataTransfer.setDragImage(element, 0, 0);

      setDragState({
        isDragging: true,
        draggedFileId: fileId,
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

      const { draggedFileId } = dragState;

      if (!draggedFileId) {
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

      // 같은 파일의 페이지 앞에 드롭하면 무시
      // (자기 자신의 위치에 드롭)
      if (targetCard && targetCard.file.id === draggedFileId) {
        setDragState(initialDragState);
        return;
      }

      onInsertFileAtPosition({
        fileId: draggedFileId,
        targetPageId
      });

      setDragState(initialDragState);
    },
    [dragState, flatCards, onInsertFileAtPosition]
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
