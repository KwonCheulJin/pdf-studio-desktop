import { useCallback, useMemo } from "react";
import {
  Trash2,
  FileText,
  Loader2,
  ZoomIn,
  ChevronsLeftRight
} from "lucide-react";
import { cn } from "@/renderer/shared/lib/utils";
import { Button, Checkbox, Tooltip } from "@/renderer/shared/ui";
import { usePdfThumbnail } from "@/renderer/shared/hooks/use-pdf-thumbnail";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import {
  useSelectionStore,
  useSelectedIds,
  useSelectionType
} from "@/renderer/shared/model/selection-store";
import { SELECTION_TYPE } from "@/renderer/shared/constants/page-state";
import { formatPageRange } from "@/renderer/shared/lib/page-range-format";
import { FLAT_CARD_TYPE } from "@/renderer/shared/constants/flat-card";
import type { DragStartParams } from "@/renderer/shared/hooks/use-unified-drag";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

interface DocumentCardProps {
  document: PdfDocument;
  /** 그룹 고유 ID (펼치기/접기용) */
  groupId: string;
  /** 그룹에 속한 페이지 ID 목록 (페이지 범위 표시용) */
  groupPageIds: string[];
  /** 이미지 고정 크기 (정사각형) */
  imageSize?: number;
  /** flatCards 배열에서의 인덱스 */
  flatIndex: number;
  // 스택 효과 표시 여부 (접힌 상태에서만)
  isStacked?: boolean;
  // 드래그 상태
  isDragging?: boolean;
  onDragStart?: (event: React.DragEvent, params: DragStartParams) => void;
  onDragEnd?: () => void;
  // Preview 모달 상태는 외부(MergeWorkspace)에서 관리
  onPreview?: (document: PdfDocument, groupPageIds: string[]) => void;
}

/**
 * 접힌 상태의 PDF 문서 카드
 * Adobe Acrobat CombineGridItem 스타일
 * - 스택 효과: thumbnailBorderTop + thumbnailBorderLeft
 * - 퀵 액션: Expand, 삭제
 * - 푸터: 파일명 + 페이지 범위
 */
export function DocumentCard({
  document,
  groupId,
  groupPageIds,
  imageSize,
  flatIndex,
  isStacked = true,
  isDragging = false,
  onDragStart,
  onDragEnd,
  onPreview
}: DocumentCardProps) {
  // Store 직접 접근
  const selectedIds = useSelectedIds();
  const selectionType = useSelectionType();
  const { toggleFileWithPages, setSelectionType } = useSelectionStore();
  const expandGroup = useMergeStore((state) => state.expandGroup);
  const removeFile = useMergeStore((state) => state.removeFile);

  const isSelected =
    selectedIds.has(document.id) && selectionType === SELECTION_TYPE.FILE;

  // 활성 페이지 ID 목록 (삭제되지 않은 것만)
  const activePageIds = document.pages
    .filter((page) => !page.isDeleted)
    .map((page) => page.id);

  // 그룹의 첫 페이지 찾기 (groupPageIds 기준)
  const groupPageIdSet = new Set(groupPageIds);
  const firstGroupPage = document.pages.find(
    (page) => groupPageIdSet.has(page.id) && !page.isDeleted
  );

  // 그룹 첫 페이지의 sourcePageIndex (1-based로 변환)
  const thumbnailPageNumber = firstGroupPage
    ? firstGroupPage.sourcePageIndex + 1
    : 1;

  const { thumbnailUrl, isLoading } = usePdfThumbnail({
    filePath: document.path,
    pageNumber: thumbnailPageNumber
  });

  // 첫 페이지 회전 상태 (썸네일에 적용)
  const firstPageRotation = firstGroupPage?.rotation ?? 0;
  const rotationStyle = { transform: `rotate(${firstPageRotation}deg)` };

  // 체크박스 클릭 핸들러 (파일 + 페이지 함께 선택/해제)
  const handleCheckboxChange = useCallback(() => {
    // 파일 선택 모드가 아니면 전환
    if (selectionType !== SELECTION_TYPE.FILE) {
      setSelectionType(SELECTION_TYPE.FILE);
    }
    // 파일과 해당 파일의 모든 페이지를 함께 토글
    toggleFileWithPages(document.id, activePageIds);
  }, [
    selectionType,
    setSelectionType,
    toggleFileWithPages,
    document.id,
    activePageIds
  ]);

  // 그룹 내 페이지 번호 목록 (분리된 그룹의 경우 해당 그룹만)
  const groupPageNumbers = useMemo(() => {
    const pageIdSet = new Set(groupPageIds);
    return document.pages
      .filter((page) => pageIdSet.has(page.id) && !page.isDeleted)
      .map((page) => page.sourcePageIndex + 1);
  }, [document.pages, groupPageIds]);
  const pageRangeText = formatPageRange(groupPageNumbers);

  // 파일 삭제 핸들러
  const handleRemove = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      removeFile(document.id);
    },
    [document.id, removeFile]
  );

  // 미리보기 핸들러
  const handlePreview = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onPreview?.(document, groupPageIds);
    },
    [document, groupPageIds, onPreview]
  );

  // 펼치기 핸들러 (그룹만 펼침)
  const handleExpand = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      // 그룹 명시적 펼침 (collapsedGroups에서 제거)
      expandGroup(groupId);
    },
    [groupId, expandGroup]
  );

  return (
    // group 클래스를 전체 컨테이너에 적용 → 텍스트 영역 호버도 감지
    <div className="group flex h-full w-full flex-col">
      {/* 카드 본문 - 스택 효과 포함, flex-1로 남은 공간 채우기 */}
      <div className="relative flex-1">
        {/* 스택 효과 (접힘 상태에서만) - Adobe thumbnailBorder 스타일 */}
        {isStacked && (
          <div className="border-border bg-card absolute -top-1.5 right-1.5 bottom-1.5 -left-1.5 rounded-[4px] border" />
        )}

        {/* 썸네일 영역 - 절대 좌표 기반으로 flex-1 사용 */}
        <div
          draggable
          onDragStart={(e) =>
            onDragStart?.(e, {
              cardType: FLAT_CARD_TYPE.FILE,
              fileId: document.id,
              pageId: null,
              flatIndex
            })
          }
          onDragEnd={onDragEnd}
          className={cn(
            "bg-card relative h-full w-full cursor-grab rounded-[4px] border transition-all hover:shadow-lg",
            isSelected
              ? "border-primary ring-primary/30 ring-2"
              : "border-border",
            isDragging && "scale-105 opacity-50"
          )}
        >
          {/* 선택 체크박스 */}
          <div
            className={cn(
              "absolute top-2 left-2 z-10 flex cursor-default items-center justify-center rounded-[4px] bg-black/60 p-2 transition-opacity",
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

          {/* 퀵 액션 버튼 (우상단) */}
          <div className="pointer-events-none absolute top-2 right-2 z-10 flex flex-col gap-1 rounded-md bg-black/60 p-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            <Tooltip content="펼치기">
              <Button
                variant="card-action"
                size="icon-sm"
                onClick={handleExpand}
                aria-label="펼치기"
                className="rounded-full"
              >
                <ChevronsLeftRight size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="삭제">
              <Button
                variant="card-action-destructive"
                size="icon-sm"
                onClick={handleRemove}
                aria-label="파일 삭제"
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
              {isLoading && (
                <Loader2
                  size={24}
                  className="text-muted-foreground animate-spin"
                />
              )}

              {!isLoading && thumbnailUrl && (
                <img
                  src={thumbnailUrl}
                  alt={`${document.name} 미리보기`}
                  className="max-h-full max-w-full object-contain"
                  style={rotationStyle}
                />
              )}

              {!isLoading && !thumbnailUrl && (
                <FileText size={24} className="text-muted-foreground" />
              )}
            </div>

            {/* 확대 버튼 (호버 시 표시) */}
            {thumbnailUrl && (
              <button
                type="button"
                onClick={handlePreview}
                className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:opacity-100 hover:bg-black/30"
                aria-label="미리보기 확대"
              >
                <ZoomIn size={24} className="text-white" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 푸터 (파일명 + 페이지 범위) */}
      <div className="mt-3 flex flex-col gap-0.5 text-center">
        <p
          className="text-foreground truncate text-sm font-medium"
          title={document.name}
        >
          {document.name}
        </p>
        <p className="text-muted-foreground text-xs">{pageRangeText}</p>
      </div>
    </div>
  );
}
