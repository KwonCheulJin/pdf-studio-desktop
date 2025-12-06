interface GridPosition {
  x: number;
  y: number;
}

interface ReorderDropZoneProps {
  index: number;
  isDragging: boolean;
  draggedIndex: number | null;
  /** 절대 좌표 위치 */
  position: GridPosition;
  /** 드롭존 높이 (카드 높이와 동일) */
  height: number;
  /** 드롭존 폭 (카드 왼쪽 절반 커버) */
  width: number;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
}

/**
 * 카드 왼쪽 절반을 커버하는 재정렬용 드롭 존 (히트 영역만)
 * 시각적 표시는 InsertionLine 컴포넌트에서 처리
 * 마우스가 카드 왼쪽 절반 위에 있으면 해당 카드 앞에 삽입
 */
export function ReorderDropZone({
  index,
  isDragging,
  draggedIndex,
  position,
  height,
  width,
  onDragOver,
  onDragLeave,
  onDrop
}: ReorderDropZoneProps) {
  // 드래그 중인 카드의 바로 앞이나 바로 뒤는 드롭 불가 (의미 없는 이동)
  const isInvalidTarget =
    draggedIndex !== null &&
    (index === draggedIndex || index === draggedIndex + 1);

  // 드래그 중이 아니거나 유효하지 않은 타겟이면 렌더링 안함
  if (!isDragging || isInvalidTarget) {
    return null;
  }

  return (
    <div
      className="absolute z-20"
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        width,
        height
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOver(e, index);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(e, index);
      }}
    />
  );
}
