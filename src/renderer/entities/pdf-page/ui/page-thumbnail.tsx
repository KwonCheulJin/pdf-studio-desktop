import { useCallback } from "react";
import { RotateCw, Trash2, Undo2, FileText, RotateCcw } from "lucide-react";
import { cn } from "@/renderer/shared/lib/utils";
import { Button, Checkbox } from "@/renderer/shared/ui";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import {
  useSelectionStore,
  useSelectedIds,
  useSelectionType
} from "@/renderer/shared/model/selection-store";
import { SELECTION_TYPE } from "@/renderer/shared/constants/page-state";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { ROTATION_DEGREES } from "@/main/types/ipc-schema";
import type { PdfPage } from "@/renderer/shared/model/pdf-document";

interface PageThumbnailProps {
  fileId: string;
  page: PdfPage;
  pageNumber: number;
  filePath: string;
  // drag 관련 (부모에서 전달)
  isDragging?: boolean;
  isDragOver?: boolean;
  dragOverPosition?: "before" | "after" | null;
  onDragStart?: (event: React.DragEvent, pageId: string) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: React.DragEvent, pageId: string) => void;
  onDragLeave?: () => void;
  onDrop?: (event: React.DragEvent, pageId: string) => void;
}

export function PageThumbnail({
  fileId,
  page,
  pageNumber,
  filePath,
  isDragging = false,
  isDragOver = false,
  dragOverPosition = null,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop
}: PageThumbnailProps) {
  // Store 직접 접근
  const selectedIds = useSelectedIds();
  const selectionType = useSelectionType();
  const { select, toggle, setSelectionType } = useSelectionStore();
  const rotatePage = useMergeStore((state) => state.rotatePage);
  const deletePage = useMergeStore((state) => state.deletePage);
  const restorePage = useMergeStore((state) => state.restorePage);

  // 페이지 선택 모드에서만 선택 상태 표시
  const isSelected =
    selectedIds.has(page.id) && selectionType === SELECTION_TYPE.PAGE;

  // 체크박스 클릭 핸들러 (selectionType 변경 포함)
  const handleCheckboxChange = useCallback(() => {
    // 페이지 선택 모드가 아니면 전환
    if (selectionType !== SELECTION_TYPE.PAGE) {
      setSelectionType(SELECTION_TYPE.PAGE);
      // 새 모드에서 현재 페이지 선택
      select(page.id);
    } else {
      // 이미 페이지 모드면 토글
      toggle(page.id);
    }
  }, [selectionType, setSelectionType, select, toggle, page.id]);

  // 시계 방향 회전 핸들러
  const handleRotateCw = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();

      try {
        await ipcClient.edit.rotatePage({
          filePath,
          pageIndex: page.sourcePageIndex,
          rotationDegrees: ROTATION_DEGREES.CW_90
        });
        rotatePage(fileId, page.id, ROTATION_DEGREES.CW_90);
      } catch (error) {
        console.error(
          `페이지 회전 실패: 페이지 ${page.sourcePageIndex + 1}`,
          error
        );
      }
    },
    [fileId, page.id, page.sourcePageIndex, filePath, rotatePage]
  );

  // 반시계 방향 회전 핸들러
  const handleRotateCcw = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();

      try {
        await ipcClient.edit.rotatePage({
          filePath,
          pageIndex: page.sourcePageIndex,
          rotationDegrees: ROTATION_DEGREES.CW_270
        });
        rotatePage(fileId, page.id, ROTATION_DEGREES.CW_270);
      } catch (error) {
        console.error(
          `페이지 회전 실패: 페이지 ${page.sourcePageIndex + 1}`,
          error
        );
      }
    },
    [fileId, page.id, page.sourcePageIndex, filePath, rotatePage]
  );

  // 페이지 삭제 핸들러
  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      deletePage(fileId, page.id);
    },
    [fileId, page.id, deletePage]
  );

  // 페이지 복원 핸들러
  const handleRestore = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      restorePage(fileId, page.id);
    },
    [fileId, page.id, restorePage]
  );

  // 회전 CSS transform
  const rotationStyle = {
    transform: `rotate(${page.rotation}deg)`
  };

  return (
    <div
      draggable={!page.isDeleted}
      onDragStart={(e) => onDragStart?.(e, page.id)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver?.(e, page.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop?.(e, page.id)}
      className={cn(
        "group bg-card relative flex cursor-grab flex-col gap-3 rounded-xl border p-3 transition-all hover:shadow-lg",
        isSelected ? "border-primary ring-primary/30 ring-2" : "border-border",
        isDragging && "scale-105 opacity-50",
        isDragOver &&
          dragOverPosition === "before" &&
          "border-l-primary border-l-4",
        isDragOver &&
          dragOverPosition === "after" &&
          "border-r-primary border-r-4",
        page.isDeleted && "opacity-40"
      )}
    >
      {/* 선택 체크박스 (shadcn/ui Checkbox) */}
      <div
        className={cn(
          "absolute top-2 left-2 z-10 transition-opacity",
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={handleCheckboxChange}
          onClick={(e) => e.stopPropagation()}
          className="size-5"
        />
      </div>

      {/* 액션 버튼 - 세로 그룹 + 배경 박스 (hover 시 표시) */}
      {!page.isDeleted && (
        <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 rounded-md bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="card-action"
            size="icon-sm"
            onClick={handleRotateCcw}
            aria-label="반시계 방향 회전"
          >
            <RotateCcw size={16} />
          </Button>
          <Button
            variant="card-action"
            size="icon-sm"
            onClick={handleRotateCw}
            aria-label="시계 방향 회전"
          >
            <RotateCw size={16} />
          </Button>
          <Button
            variant="card-action-destructive"
            size="icon-sm"
            onClick={handleDelete}
            aria-label="페이지 삭제"
          >
            <Trash2 size={16} />
          </Button>
        </div>
      )}

      {/* 삭제된 페이지 복원 버튼 */}
      {page.isDeleted && (
        <div className="absolute top-2 right-2 z-10">
          <Button
            variant="default"
            size="icon-sm"
            onClick={handleRestore}
            aria-label="페이지 복원"
          >
            <Undo2 size={16} />
          </Button>
        </div>
      )}

      {/* 썸네일 - ExpandedPageCard와 동일 크기 */}
      <div className="bg-muted relative flex h-28 w-full items-center justify-center overflow-hidden rounded-sm">
        {page.thumbnailUrl ? (
          <img
            src={page.thumbnailUrl}
            alt={`페이지 ${pageNumber}`}
            className="h-full w-full object-contain"
            style={rotationStyle}
          />
        ) : (
          <FileText size={24} className="text-muted-foreground" />
        )}

        {/* 삭제된 페이지 오버레이 */}
        {page.isDeleted && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Trash2 size={24} className="text-white" />
          </div>
        )}
      </div>

      {/* 페이지 번호 */}
      <p
        className={cn(
          "text-center text-sm font-medium",
          page.isDeleted
            ? "text-muted-foreground line-through"
            : "text-foreground"
        )}
      >
        {pageNumber}
      </p>
    </div>
  );
}
