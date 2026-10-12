import { Plus } from "lucide-react";
import type { GridPosition } from "@/renderer/shared/lib/layout-calculator";

interface DropZoneIndicatorProps {
  /** 드롭 영역 절대 좌표 */
  position: GridPosition;
  /** 드롭 영역 높이 */
  height: number;
  /** 드롭 영역 너비 (확장된 갭) */
  width: number;
}

/** Plus 아이콘 크기 (정사각형) */
const ICON_SIZE = 40;

/**
 * 갭 확장 영역에 표시되는 드롭 인디케이터
 * Adobe Acrobat 스타일 - 외부 파일 드래그 시 CirclePlus 아이콘만 표시
 */
export function DropZoneIndicator({
  position,
  height,
  width
}: DropZoneIndicatorProps) {
  return (
    <div
      data-testid="drop-indicator"
      className="pointer-events-none absolute flex items-center justify-center"
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        width,
        height
      }}
    >
      {/* 정원, 정중앙 */}
      <div
        className="bg-primary text-primary-foreground animate-in fade-in flex items-center justify-center rounded-full shadow-lg duration-150"
        style={{
          width: ICON_SIZE,
          height: ICON_SIZE,
          minWidth: ICON_SIZE,
          minHeight: ICON_SIZE
        }}
      >
        <Plus size={20} />
      </div>
    </div>
  );
}
