import { useCallback, useMemo } from "react";
import {
  Trash2,
  FileText,
  Loader2,
  ZoomIn,
  ChevronsLeftRight
} from "lucide-react";
import {
  useMergeStore,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import { cn } from "@/renderer/shared/lib/utils";
import { Button, Checkbox, Tooltip } from "@/renderer/shared/ui";
import { formatDocumentCaption } from "../lib/document-caption";
import { usePageThumbnail } from "../model/use-page-thumbnail";
import {
  useSelectionStore,
  useSelectedIds,
  useSelectionType
} from "../model/selection-store";
import { SELECTION_TYPE } from "../config/selection-type";

interface DocumentCardProps {
  document: PdfDocument;
  /** 그룹 고유 ID (펼치기/접기용) */
  groupId: string;
  /** 그룹에 속한 페이지 ID 목록 (페이지 범위 표시용) */
  groupPageIds: string[];
  /** 그룹에서 삭제된(복원 가능한) 페이지 수 */
  deletedPageCount: number;
  /** 이미지 고정 크기 (정사각형) */
  imageSize?: number;
  // 스택 효과 표시 여부 (접힌 상태에서만)
  isStacked?: boolean;
  // Preview 모달 상태는 외부(MergeWorkspace)에서 관리
  onPreview?: (document: PdfDocument, groupPageIds: string[]) => void;
}

/**
 * 접힌 상태의 PDF 문서 카드
 * Adobe Acrobat CombineGridItem 스타일
 * - 스택 효과: thumbnailBorderTop + thumbnailBorderLeft
 * - 퀵 액션: Expand, 삭제
 * - 삭제된 페이지가 있으면 썸네일 왼쪽 아래 "n쪽 삭제됨" 배지 (펼쳐서 복원)
 * - 푸터: 파일명 + 쪽수 (일부만 남았으면 남은 쪽 범위)
 */
export function DocumentCard({
  document,
  groupId,
  groupPageIds,
  deletedPageCount,
  imageSize,
  isStacked = true,
  onPreview
}: DocumentCardProps) {
  // Store 직접 접근
  const selectedIds = useSelectedIds();
  const selectionType = useSelectionType();
  const { toggleFileWithPages, setSelectionType, ensurePagesSelected } =
    useSelectionStore();
  const expandGroup = useMergeStore((state) => state.expandGroup);
  const removeFile = useMergeStore((state) => state.removeFile);

  const isSelected =
    selectedIds.has(document.id) && selectionType === SELECTION_TYPE.FILE;

  // 활성 페이지 ID 목록 (삭제되지 않은 것만)
  const activePageIds = useMemo(
    () =>
      document.pages.filter((page) => !page.isDeleted).map((page) => page.id),
    [document.pages]
  );

  // 그룹의 첫 페이지 찾기 (groupPageIds 기준)
  const groupPageIdSet = useMemo(() => new Set(groupPageIds), [groupPageIds]);
  const firstGroupPage = document.pages.find(
    (page) => groupPageIdSet.has(page.id) && !page.isDeleted
  );

  // 그룹 첫 페이지 썸네일. 펼친 카드의 같은 페이지와 렌더 결과를 함께 쓴다.
  const {
    ref: thumbnailRef,
    thumbnailUrl,
    isLoading
  } = usePageThumbnail({
    filePath: document.path,
    pageIndex: firstGroupPage?.sourcePageIndex ?? 0
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
  const captionText = formatDocumentCaption({
    activePageNumbers: groupPageNumbers,
    totalPageCount: document.pages.length
  });

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
      // 파일이 선택된 상태라면 모든 페이지 ID도 selectedIds에 추가
      if (isSelected) {
        ensurePagesSelected(activePageIds);
      }
    },
    [groupId, expandGroup, isSelected, activePageIds, ensurePagesSelected]
  );

  return (
    // group 클래스를 전체 컨테이너에 적용 → 텍스트 영역 호버도 감지
    <div
      data-testid="document-card"
      className="group flex h-full w-full flex-col"
    >
      {/* 카드 본문(종이) - 스택 효과 포함, flex-1로 남은 공간 채우기 */}
      <div className="relative flex-1">
        {/* 스택 효과 (접힘 상태에서만) - 뒤에 깔린 종이 */}
        {isStacked && (
          <div className="border-border bg-paper absolute -top-1.5 right-1.5 bottom-1.5 -left-1.5 rounded-xs border" />
        )}

        {/* 썸네일 영역 - 종이. 고르면 2px primary 테두리 */}
        <div
          className={cn(
            "bg-paper shadow-paper relative h-full w-full cursor-grab rounded-xs transition-all hover:shadow-lg",
            isSelected ? "border-primary border-2" : "border border-transparent"
          )}
        >
          {/* 선택 체크박스 (고르면 늘, 아니면 마우스·포커스일 때) */}
          <div
            className={cn(
              "absolute top-2 left-2 z-10 flex cursor-default transition-opacity",
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
              aria-label={`${document.name} 선택`}
              className="bg-paper size-5"
            />
          </div>

          {/* 퀵 액션 버튼 (우상단) */}
          <div className="border-border bg-card pointer-events-none absolute top-2 right-2 z-10 flex flex-col gap-0.5 rounded-md border p-1 opacity-0 shadow-sm transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
            <Tooltip content="펼치기">
              <Button
                variant="card-action"
                size="icon-sm"
                onClick={handleExpand}
                aria-label="펼치기"
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
              >
                <Trash2 size={16} />
              </Button>
            </Tooltip>
          </div>

          {/* 썸네일 이미지 - 회전해도 종이 안에 들도록 정사각형 상자 */}
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xs">
            <div
              ref={thumbnailRef}
              className="flex items-center justify-center overflow-hidden"
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

            {/* 확대 버튼 (호버·포커스 시 표시). 카드 본문 클릭은 선택이므로 가운데 버튼만 누른다 */}
            {thumbnailUrl && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={handlePreview}
                  className="border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring pointer-events-auto rounded-full border p-3 shadow-sm focus-visible:ring-2 focus-visible:outline-none"
                  aria-label="미리보기 확대"
                >
                  <ZoomIn size={24} />
                </button>
              </div>
            )}
          </div>

          {deletedPageCount > 0 && (
            <span className="border-border bg-muted text-muted-foreground pointer-events-none absolute bottom-2 left-2 rounded-full border px-2 text-xs/5 font-medium whitespace-nowrap">
              {deletedPageCount}쪽 삭제됨
            </span>
          )}
        </div>
      </div>

      {/* 푸터 (파일명 + 쪽수) */}
      <div className="mt-3 flex flex-col gap-0.5 text-center">
        <p
          className="text-foreground truncate text-sm/5.25 font-medium"
          title={document.name}
        >
          {document.name}
        </p>
        <p className="text-muted-foreground text-xs/4.25">{captionText}</p>
      </div>
    </div>
  );
}
