interface GridPosition {
  x: number;
  y: number;
}

interface GridItemWrapperProps {
  children: React.ReactNode;
  /** 절대 좌표 위치 */
  position: GridPosition;
  /** 카드 폭 (px) */
  cardWidth: number;
  /** 카드 높이 (px) */
  cardHeight: number;
}

/**
 * 카드를 절대 좌표로 배치하는 래퍼
 * Adobe Acrobat 스타일 - 갭 확장 애니메이션을 위한 transition 포함
 */
export function GridItemWrapper({
  children,
  position,
  cardWidth,
  cardHeight
}: GridItemWrapperProps) {
  return (
    <div
      className="absolute transition-transform duration-200 ease-out"
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        width: cardWidth,
        height: cardHeight
      }}
    >
      {children}
    </div>
  );
}
