import { useCallback } from "react";
import {
  RotateCw,
  RotateCcw,
  Trash2,
  ChevronsLeftRight,
  FileText,
  ZoomIn
} from "lucide-react";
import { cn } from "@/renderer/shared/lib/utils";
import { Button, Checkbox, Tooltip } from "@/renderer/shared/ui";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import {
  useSelectionStore,
  useSelectedIds,
  useSelectionType
} from "@/renderer/shared/model/selection-store";
import { SELECTION_TYPE } from "@/renderer/shared/constants/page-state";
import { FLAT_CARD_TYPE } from "@/renderer/shared/constants/flat-card";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { ROTATION_DEGREES } from "@/main/types/ipc-schema";
import type { PdfPage } from "@/renderer/shared/model/pdf-document";
import type { GroupColor } from "@/renderer/shared/constants/group-colors";
import type { DragStartParams } from "@/renderer/shared/hooks/use-unified-drag";

interface ExpandedPageCardProps {
  fileId: string;
  filePath: string;
  page: PdfPage;
  pageNumber: number; // 원본 페이지 번호 (1-based)
  flatIndex: number; // flatCards 배열에서의 인덱스
  fileName: string;
  /** 이미지 고정 크기 (정사각형) */
  imageSize?: number;
  groupColor?: GroupColor; // 파일 그룹 구분 테두리 색상
  /** 그룹 고유 ID (연속된 같은 파일 페이지 그룹) */
  groupId: string;
  showCollapseButton?: boolean; // 첫 카드에만 접기 버튼 표시
  isStacked?: boolean; // 스택 효과 표시 여부 (펼침 상태의 첫 페이지만)
  // 드래그 상태
  isDragging?: boolean;
  onDragStart?: (event: React.DragEvent, params: DragStartParams) => void;
  onDragEnd?: () => void;
  /** 미리보기 콜백 (fileId, pageIndex) */
  onPreview?: (fileId: string, pageIndex: number) => void;
}

/**
 * 펼침 상태의 개별 페이지 카드
 * Adobe Acrobat 펼침 상태 스타일
 * - 스택 효과: 첫 페이지만 (isStacked prop)
 * - 퀵 액션: Collapse (첫 페이지만), 회전, 삭제
 * - 푸터: 파일명 + 단일 페이지 번호
 */
export function ExpandedPageCard({
  fileId,
  filePath,
  page,
  pageNumber,
  flatIndex,
  fileName,
  imageSize,
  groupColor,
  groupId,
  showCollapseButton = false,
  isStacked = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
  onPreview
}: ExpandedPageCardProps) {
  // Store 직접 접근
  const selectedIds = useSelectedIds();
  const selectionType = useSelectionType();
  const { select, toggle, setSelectionType } = useSelectionStore();
  const rotatePage = useMergeStore((state) => state.rotatePage);
  const deletePage = useMergeStore((state) => state.deletePage);
  const toggleGroupExpand = useMergeStore((state) => state.toggleGroupExpand);

  // 파일 선택 모드에서도 해당 파일의 페이지가 선택 표시되도록
  const isFileSelected =
    selectedIds.has(fileId) && selectionType === SELECTION_TYPE.FILE;
  const isPageSelected =
    selectedIds.has(page.id) && selectionType === SELECTION_TYPE.PAGE;
  const isSelected = isFileSelected || isPageSelected;

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

  // 그룹 접기 핸들러
  const handleCollapse = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      toggleGroupExpand(groupId);
    },
    [groupId, toggleGroupExpand]
  );

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

  // 미리보기 핸들러
  const handlePreview = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onPreview?.(fileId, page.sourcePageIndex);
    },
    [fileId, page.sourcePageIndex, onPreview]
  );

  // 회전 CSS transform
  const rotationStyle = {
    transform: `rotate(${page.rotation}deg)`
  };

  return (
    // group 클래스를 전체 컨테이너에 적용 → 텍스트 영역 호버도 감지
    <div className="group flex h-full w-full flex-col">
      {/* 카드 본문 - 스택 효과 포함, flex-1로 남은 공간 채우기 */}
      <div className="relative flex-1">
        {/* 스택 효과 (펼침 상태의 첫 페이지만) - Adobe thumbnailBorder 스타일 */}
        {isStacked && (
          <div className="border-border bg-card absolute -top-1.5 right-1.5 bottom-1.5 -left-1.5 rounded-[4px] border" />
        )}

        {/* 썸네일 영역 - 절대 좌표 기반으로 h-full 사용 */}
        <div
          draggable
          onDragStart={(e) =>
            onDragStart?.(e, {
              cardType: FLAT_CARD_TYPE.PAGE,
              fileId,
              pageId: page.id,
              flatIndex
            })
          }
          onDragEnd={onDragEnd}
          className={cn(
            "bg-card relative h-full w-full cursor-grab rounded-[4px] border p-3 transition-all hover:shadow-lg",
            isSelected
              ? "border-primary ring-primary/30 ring-2"
              : "border-border",
            groupColor && !isSelected && groupColor,
            isDragging && "scale-105 opacity-50"
          )}
        >
          {/* 선택 체크박스 */}
          <div
            className={cn(
              "absolute top-2 left-2 z-10 flex cursor-default items-center justify-center rounded-[4px] bg-black/60 p-2 transition-opacity",
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={handleCheckboxChange}
              onClick={(e) => e.stopPropagation()}
              className="size-5"
            />
          </div>

          {/* 퀵 액션 버튼 (우상단) - Collapse, 미리보기, 회전, 삭제 */}
          <div className="pointer-events-none absolute top-2 right-2 z-10 flex cursor-default flex-col gap-1 rounded-md bg-black/60 p-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            {showCollapseButton && (
              <Tooltip content="접기">
                <Button
                  variant="card-action"
                  size="icon-sm"
                  onClick={handleCollapse}
                  aria-label="접기"
                  className="rounded-full"
                >
                  <ChevronsLeftRight size={16} />
                </Button>
              </Tooltip>
            )}
            <Tooltip content="미리보기">
              <Button
                variant="card-action"
                size="icon-sm"
                onClick={handlePreview}
                aria-label="미리보기"
                className="rounded-full"
              >
                <ZoomIn size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="왼쪽으로 회전">
              <Button
                variant="card-action"
                size="icon-sm"
                onClick={handleRotateCcw}
                aria-label="반시계 방향 회전"
                className="rounded-full"
              >
                <RotateCcw size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="오른쪽으로 회전">
              <Button
                variant="card-action"
                size="icon-sm"
                onClick={handleRotateCw}
                aria-label="시계 방향 회전"
                className="rounded-full"
              >
                <RotateCw size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="삭제">
              <Button
                variant="card-action-destructive"
                size="icon-sm"
                onClick={handleDelete}
                aria-label="페이지 삭제"
                className="rounded-full"
              >
                <Trash2 size={16} />
              </Button>
            </Tooltip>
          </div>

          {/* 썸네일 이미지 - 고정 크기 컨테이너 */}
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded">
            <div
              className="bg-muted flex items-center justify-center overflow-hidden rounded"
              style={
                imageSize ? { width: imageSize, height: imageSize } : undefined
              }
            >
              {page.thumbnailUrl ? (
                <img
                  src={page.thumbnailUrl}
                  alt={`${fileName} 페이지 ${pageNumber}`}
                  className="max-h-full max-w-full object-contain"
                  style={rotationStyle}
                />
              ) : (
                <FileText size={24} className="text-muted-foreground" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 푸터 (파일명 + 단일 페이지 번호) */}
      <div className="mt-3 flex flex-col gap-0.5 text-center">
        <p
          className="text-foreground truncate text-sm font-medium"
          title={fileName}
        >
          {fileName}
        </p>
        <p className="text-muted-foreground text-xs">{pageNumber}</p>
      </div>
    </div>
  );
}
