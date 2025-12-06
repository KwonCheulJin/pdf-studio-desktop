import { Plus } from "lucide-react";

interface DropZonePosition {
  x: number;
  y: number;
}

interface DropZoneIndicatorProps {
  /** 드롭 영역 절대 좌표 */
  position: DropZonePosition;
  /** 드롭 영역 높이 */
  height: number;
  /** 드롭 영역 너비 (확장된 갭) */
  width: number;
  /** 활성화 여부 */
  isActive: boolean;
  /** 외부 파일 드래그 여부 */
  isFileDragging: boolean;
  /** 드래그 오버 핸들러 */
  onDragOver: (e: React.DragEvent) => void;
  /** 드래그 리브 핸들러 */
  onDragLeave: () => void;
  /** 드롭 핸들러 */
  onDrop: (e: React.DragEvent) => void;
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
  width,
  isActive,
  isFileDragging,
  onDragOver,
  onDragLeave,
  onDrop
}: DropZoneIndicatorProps) {
  if (!isActive) return null;

  return (
    <div
      className="absolute flex items-center justify-center"
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        width,
        height
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOver(e);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(e);
      }}
    >
      {/* 외부 파일 드래그 시에만 Plus 표시 (정원, 정중앙) */}
      {isFileDragging && (
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
      )}
    </div>
  );
}
