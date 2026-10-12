import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/renderer/shared/lib/utils";
import type { GridPosition } from "@/renderer/shared/lib/layout-calculator";

interface SortableCardProps {
  /** 정렬 목록에서 카드를 구분하는 ID */
  id: string;
  /** 스크린 리더가 읽는 카드 이름 */
  label: string;
  /** 그리드 안 절대 좌표 */
  position: GridPosition;
  cardWidth: number;
  cardHeight: number;
  children: React.ReactNode;
}

const ROLE_DESCRIPTION = "순서를 바꿀 수 있는 카드";

/**
 * 끌어서(포인터) 또는 키보드로(Space 집기 → 방향키 → Space 놓기, Esc 취소) 순서를 바꾸는 카드.
 * 그리드 좌표는 left/top으로 두고 transform은 정렬 중 이동량에만 쓴다.
 * dnd-kit은 transform을 뺀 자리로 카드 위치를 재므로 좌표를 transform에 넣으면 모든 카드가 한 점에 겹친다.
 */
export function SortableCard({
  id,
  label,
  position,
  cardWidth,
  cardHeight,
  children
}: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, attributes: { roleDescription: ROLE_DESCRIPTION } });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      className={cn(
        "focus-visible:ring-primary absolute rounded-[4px] outline-none focus-visible:ring-2",
        isDragging
          ? "z-40 opacity-80"
          : "transition-[left,top] duration-200 ease-out"
      )}
      style={{
        left: position.x,
        top: position.y,
        width: cardWidth,
        height: cardHeight,
        transform: CSS.Translate.toString(transform),
        transition
      }}
    >
      {children}
    </div>
  );
}
