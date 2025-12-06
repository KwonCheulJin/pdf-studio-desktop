# Drag & Drop 애니메이션 가이드 (shadcn data-table 패턴)

지정된 예제(`shadcn-ui/ui/deprecated/www/components/cards/data-table.tsx`)에는 DnD 구현이 없지만, 동일한 UI 톤을 유지하면서 테이블/그리드 항목에 드래그 앤 드롭 애니메이션을 입히는 최소 로직만 정리했습니다. `@dnd-kit` 기본 애니메이션 패턴을 그대로 가져오면 PDF Studio의 Merge/Grid 화면에도 바로 적용할 수 있습니다.

## 핵심 포인트
- `@dnd-kit/sortable`의 `useSortable`에서 제공하는 `transform`·`transition` 값을 그대로 스타일에 주입.
- 드래그 중에는 `opacity`/`z-index`를 올려 겹침 방지, 놓을 때는 `dropAnimation`으로 부드럽게 정착.
- 모든 항목을 `SortableContext`로 감싸고, `onDragEnd`에서 순서만 교체(`arrayMove`)하면 나머지 애니메이션은 자동 적용.

## 적용 순서
1) 패키지 설치 (문서 참고용 명령)
```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

2) 드래그 가능한 행/카드 컴포넌트
```tsx
import { useSortable, defaultDropAnimation, type DropAnimation } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

interface SortableRowProps {
  id: string
  children: React.ReactNode
}

const dropAnimation: DropAnimation = {
  ...defaultDropAnimation,
  // 놓을 때 살짝 튕기는 효과
  keyframes: [
    { transform: "scale(1.02)" },
    { transform: "scale(1)" },
  ],
  easing: "cubic-bezier(0.25, 1, 0.5, 1)",
}

export function SortableRow({ id, children }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: {
      duration: 200,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
    },
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 200ms cubic-bezier(0.25, 1, 0.5, 1)",
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <tr ref={setNodeRef} style={style} {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
      {children}
    </tr>
  )
}
```

3) 컨텍스트와 정렬 로직 (테이블/그리드 공통)
```tsx
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove } from "@dnd-kit/sortable"

function SortableTable({ rows, onReorder }: { rows: string[]; onReorder: (next: string[]) => void }) {
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = rows.indexOf(String(active.id))
    const newIndex = rows.indexOf(String(over.id))
    onReorder(arrayMove(rows, oldIndex, newIndex))
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={rows}>
        <table className="w-full border-collapse">
          <tbody>
            {rows.map((rowId) => (
              <SortableRow key={rowId} id={rowId}>
                {/* 셀 렌더링 */}
              </SortableRow>
            ))}
          </tbody>
        </table>
      </SortableContext>
    </DndContext>
  )
}
```

## PDF Studio에 적용할 때
- 위치: `widgets/merge-workspace`나 `widgets/page-edit-workspace`의 카드/행 래퍼에 `SortableRow`를 적용.
- 상태: 순서 배열은 해당 feature 스토어(또는 로컬 상태)에서 관리, `onReorder`로만 업데이트.
- 스타일: `transition`·`opacity`는 Tailwind로 치환 가능 (`transition-transform`, `duration-200`, `ease-out`)—드래그 중 추가 하이라이트는 `isDragging` 분기에서 `shadow-lg ring-2 ring-sky-400` 등을 더해 UI 일관성을 맞추면 된다.

## 체크리스트
- [ ] `SortableContext`가 항목 리스트를 감싸고 있는가?
- [ ] `useSortable`에서 반환한 `transform`·`transition`을 스타일에 그대로 반영했는가?
- [ ] 드래그 중 시각적 구분(`opacity`, `shadow`, `z-index`)이 적용되는가?
- [ ] 드래그 종료 시 `onReorder`에서만 순서가 갱신되는가? (기존 상태는 건드리지 않음)
- [ ] Drop 애니메이션 이asing/지속 시간은 전체 앱 모션 톤과 일치하는가?
