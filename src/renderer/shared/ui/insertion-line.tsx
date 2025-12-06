interface GridPosition {
  x: number;
  y: number;
}

interface InsertionLineProps {
  /** 삽입 선 위치 */
  position: GridPosition;
  /** 선 높이 (카드 높이와 동일) */
  height: number;
  /** 활성화 상태 */
  isActive: boolean;
}

/**
 * Adobe Acrobat 스타일 삽입 표시선
 * 드래그 중인 카드가 삽입될 위치를 세로선으로 표시
 */
export function InsertionLine({
  position,
  height,
  isActive
}: InsertionLineProps) {
  if (!isActive) return null;

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        width: 4,
        height
      }}
    >
      {/* 삽입 표시선 */}
      <div className="bg-primary h-full w-full rounded-full opacity-80" />
    </div>
  );
}
