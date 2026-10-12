import { useCallback } from "react";
import {
  RotateCw,
  RotateCcw,
  Trash2,
  ChevronsLeftRight,
  FileText,
  Undo2,
  ZoomIn
} from "lucide-react";
import {
  useMergeFiles,
  useMergeStore,
  type PdfPage
} from "@/renderer/entities/merge-plan";
import { cn } from "@/renderer/shared/lib/utils";
import { Button, Checkbox, Tooltip } from "@/renderer/shared/ui";
import type { GroupColor } from "@/renderer/shared/constants/group-colors";
import {
  useSelectionStore,
  useSelectedIds,
  useSelectionType
} from "../model/selection-store";
import { usePageRotateHandlers } from "../model/use-page-rotate-handlers";
import { usePageThumbnail } from "../model/use-page-thumbnail";
import { SELECTION_TYPE } from "../config/selection-type";

interface ExpandedPageCardProps {
  fileId: string;
  filePath: string;
  page: PdfPage;
  pageNumber: number; // 원본 페이지 번호 (1-based)
  fileName: string;
  /** 이미지 고정 크기 (정사각형) */
  imageSize?: number;
  groupColor?: GroupColor; // 파일 그룹 구분 테두리 색상
  /** 그룹 고유 ID (연속된 같은 파일 페이지 그룹) */
  groupId: string;
  showCollapseButton?: boolean; // 첫 카드에만 접기 버튼 표시
  isStacked?: boolean; // 스택 효과 표시 여부 (펼침 상태의 첫 페이지만)
  /** 미리보기 콜백 (fileId, pageIndex) */
  onPreview?: (fileId: string, pageIndex: number) => void;
}

/**
 * 펼침 상태의 개별 페이지 카드
 * Adobe Acrobat 펼침 상태 스타일
 * - 스택 효과: 첫 페이지만 (isStacked prop)
 * - 퀵 액션: Collapse (첫 페이지만), 회전, 삭제
 * - 삭제된 페이지: 제자리에 흐리게(점선 테두리) + "삭제됨" 배지 + 복원 버튼
 * - 푸터: 파일명 + 단일 페이지 번호
 */
export function ExpandedPageCard({
  fileId,
  filePath,
  page,
  pageNumber,
  fileName,
  imageSize,
  groupColor,
  groupId,
  showCollapseButton = false,
  isStacked = false,
  onPreview
}: ExpandedPageCardProps) {
  // Store 직접 접근
  const selectedIds = useSelectedIds();
  const selectionType = useSelectionType();
  const { toggle, switchToPageMode } = useSelectionStore();
  const files = useMergeFiles();
  const deletePage = useMergeStore((state) => state.deletePage);
  const restorePage = useMergeStore((state) => state.restorePage);
  const toggleGroupExpand = useMergeStore((state) => state.toggleGroupExpand);

  const { handleRotateCw, handleRotateCcw } = usePageRotateHandlers({
    fileId,
    page
  });
  const { ref: thumbnailRef, thumbnailUrl } = usePageThumbnail({
    filePath,
    pageIndex: page.sourcePageIndex
  });

  // 파일 선택 모드에서도 해당 파일의 페이지가 선택 표시되도록
  const isFileSelected =
    selectedIds.has(fileId) && selectionType === SELECTION_TYPE.FILE;
  const isPageSelected =
    selectedIds.has(page.id) && selectionType === SELECTION_TYPE.PAGE;
  const isSelected = isFileSelected || isPageSelected;

  // 체크박스 클릭 핸들러 (selectionType 변경 포함)
  const handleCheckboxChange = useCallback(() => {
    if (selectionType !== SELECTION_TYPE.PAGE) {
      // FILE 모드에서 전환: 파일 ID 제거 후 PAGE 모드로 전환하면서 이 페이지 토글
      const fileIds = files.map((f) => f.id);
      switchToPageMode(fileIds, page.id);
    } else {
      // 이미 페이지 모드면 토글
      toggle(page.id);
    }
  }, [selectionType, files, switchToPageMode, toggle, page.id]);

  // 그룹 접기 핸들러
  const handleCollapse = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      toggleGroupExpand(groupId);
    },
    [groupId, toggleGroupExpand]
  );

  // 페이지 삭제 핸들러
  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      deletePage(fileId, page.id);
    },
    [fileId, page.id, deletePage]
  );

  // 페이지 복원 핸들러 (병합 순서의 원래 자리로 돌아온다)
  const handleRestore = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      restorePage(fileId, page.id);
    },
    [fileId, page.id, restorePage]
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
    <div data-testid="page-card" className="group flex h-full w-full flex-col">
      {/* 카드 본문 - 스택 효과 포함, flex-1로 남은 공간 채우기 */}
      <div className="relative flex-1">
        {/* 스택 효과 (펼침 상태의 첫 페이지만) - Adobe thumbnailBorder 스타일 */}
        {isStacked && (
          <div className="border-border bg-card absolute -top-1.5 right-1.5 bottom-1.5 -left-1.5 rounded-[4px] border" />
        )}

        {/* 썸네일 영역 - 절대 좌표 기반으로 h-full 사용 */}
        <div
          className={cn(
            "bg-card relative h-full w-full cursor-grab rounded-[4px] border p-3 transition-all hover:shadow-lg",
            isSelected
              ? "border-primary ring-primary/30 ring-2"
              : "border-border",
            groupColor && !isSelected && !page.isDeleted && groupColor,
            page.isDeleted && "border-muted-foreground border-dashed"
          )}
        >
          {/* 선택 체크박스 */}
          <div
            className={cn(
              "absolute top-2 left-2 z-10 flex cursor-default items-center justify-center rounded-[4px] bg-black/60 p-2 transition-opacity",
              isSelected
                ? "opacity-100"
                : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={handleCheckboxChange}
              onClick={(e) => e.stopPropagation()}
              aria-label={`${fileName} ${pageNumber}쪽 선택`}
              className="size-5"
            />
          </div>

          {/* 퀵 액션 버튼 (우상단) - Collapse, 미리보기, 회전, 삭제. 삭제된 페이지는 접기만 */}
          {(showCollapseButton || !page.isDeleted) && (
            <div className="pointer-events-none absolute top-2 right-2 z-10 flex cursor-default flex-col gap-1 rounded-md bg-black/60 p-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
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
              {!page.isDeleted && (
                <>
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
                </>
              )}
            </div>
          )}

          {/* 삭제된 페이지: 배지 + 복원 버튼 (썸네일만 흐리게, 버튼은 그대로) */}
          {page.isDeleted && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
              <span className="bg-destructive text-destructive-foreground rounded px-2 py-0.5 text-xs font-medium">
                삭제됨
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRestore}
                aria-label="페이지 복원"
                className="pointer-events-auto"
              >
                <Undo2 size={14} />
                복원
              </Button>
            </div>
          )}

          {/* 썸네일 이미지 - 고정 크기 컨테이너 */}
          <div
            className={cn(
              "relative flex h-full w-full items-center justify-center overflow-hidden rounded",
              page.isDeleted && "opacity-40"
            )}
          >
            <div
              ref={thumbnailRef}
              className="bg-muted flex items-center justify-center overflow-hidden rounded"
              style={
                imageSize ? { width: imageSize, height: imageSize } : undefined
              }
            >
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
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
