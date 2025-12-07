import React, {
  useMemo,
  useCallback,
  useRef,
  useState,
  useEffect
} from "react";
import { DocumentCard } from "@/renderer/entities/pdf-document";
import { ExpandedPageCard } from "@/renderer/entities/pdf-page";
import {
  useMergeStore,
  useMergeOrder,
  useCollapsedGroups
} from "@/renderer/shared/model/merge-store";
import { useUnifiedDrag } from "@/renderer/shared/hooks/use-unified-drag";
import { usePdfThumbnails } from "@/renderer/shared/hooks/use-pdf-thumbnails";
import { useResponsiveGridLayout } from "@/renderer/shared/hooks/use-responsive-grid-layout";
import { useFileDropZone } from "@/renderer/shared/hooks/use-file-drop-zone";
import { useCardSize } from "@/renderer/shared/model/zoom-store";
import { getGroupColor } from "@/renderer/shared/constants/group-colors";
import { GRID_CONFIG } from "@/renderer/shared/constants/grid-layout";
import {
  GridItemWrapper,
  ReorderDropZone,
  DropZoneIndicator,
  InsertionLine
} from "@/renderer/shared/ui";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";
import {
  flattenFileGrid,
  type FlatCard
} from "@/renderer/shared/lib/flatten-file-grid";
import { FLAT_CARD_TYPE } from "@/renderer/shared/constants/flat-card";
import {
  getDropZonePosition as calcDropZonePosition,
  getDropZoneWidth as calcDropZoneWidth,
  getInsertionLinePosition as calcInsertionLinePosition
} from "@/renderer/shared/lib/layout-calculator";
import { mergeUploadingFiles } from "@/renderer/shared/lib/merge-uploading-files";
import { UploadingCard } from "./uploading-card";

interface FileGridProps {
  files: PdfDocument[];
  onPreviewFile: (document: PdfDocument, groupPageIds: string[]) => void;
  onPreviewPage: (fileId: string, pageIndex: number) => void;
}

/**
 * 파일의 썸네일을 생성하는 컴포넌트
 */
function FileThumbnails({ file }: { file: PdfDocument }) {
  usePdfThumbnails({
    fileId: file.id,
    filePath: file.path,
    pageCount: file.pageCount,
    enabled: true
  });
  return null;
}

export function FileGrid({
  files,
  onPreviewFile,
  onPreviewPage
}: FileGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const mergeOrder = useMergeOrder();
  const collapsedGroups = useCollapsedGroups();
  const insertFileAtPosition = useMergeStore(
    (state) => state.insertFileAtPosition
  );
  const userCardSize = useCardSize();

  // ResizeObserver로 컨테이너 너비 감지
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(container);
    // 초기 너비 설정
    setContainerWidth(container.getBoundingClientRect().width);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 모든 카드를 평면화 (펼침 상태 페이지 포함, mergeOrder 기반)
  const flatCards = useMemo<FlatCard[]>(
    () => flattenFileGrid({ files, mergeOrder, collapsedGroups }),
    [files, mergeOrder, collapsedGroups]
  );

  // 통합 드래그 훅
  const {
    dragState,
    handleCardDragStart,
    handleCardDragEnd,
    handleDropZoneDragOver,
    handleDropZoneDragLeave,
    handleDropZoneDrop
  } = useUnifiedDrag({
    flatCards,
    files,
    onInsertFileAtPosition: insertFileAtPosition
  });

  // 드래그 상태
  const isCardDragging = dragState.isDragging;

  // 활성 드롭 인덱스 결정
  const activeDropIndexForLayout = useMemo(() => {
    if (!isCardDragging) return null;
    return dragState.dropTargetFlatIndex;
  }, [isCardDragging, dragState.dropTargetFlatIndex]);

  // 반응형 레이아웃 계산 (기본)
  const { columns, cardSize, cardHeight, imageSize } = useResponsiveGridLayout({
    itemsCount: flatCards.length,
    viewportWidth: containerWidth,
    activeDropIndex: activeDropIndexForLayout,
    userCardSize
  });

  // 파일 드롭 관련 훅 (columns와 flatCards.length 필요)
  const {
    isFileDragOver,
    activeDropIndex: fileDropIndex,
    uploadingFiles,
    handleFileDragOver,
    handleFileDragLeave,
    handleFileDrop
  } = useFileDropZone({
    containerRef,
    columns,
    itemsCount: flatCards.length,
    cardSize,
    cardHeight
  });

  // 파일 드래그 시 활성 드롭 인덱스
  const activeDropIndexForFileUpload = isFileDragOver ? fileDropIndex : null;

  // 업로드 중인 파일 포함한 전체 아이템 수
  const totalItemsCount = flatCards.length + uploadingFiles.length;

  // 최종 레이아웃 계산 (업로드 중인 파일 포함 + 파일 드래그 시 갭 확장)
  const { positions, containerHeight } = useResponsiveGridLayout({
    itemsCount: totalItemsCount,
    viewportWidth: containerWidth,
    activeDropIndex: activeDropIndexForFileUpload ?? activeDropIndexForLayout,
    userCardSize
  });

  // 모든 파일의 썸네일 생성 (펼침/접힘 상태 무관)

  // ReorderDropZone 위치 계산 함수 (gap + 카드 왼쪽 절반 영역)
  const getDropZonePosition = useCallback(
    (index: number) =>
      calcDropZonePosition({
        index,
        positions,
        flatCardsLength: flatCards.length,
        cardSize,
        gap: GRID_CONFIG.GAP,
        padding: GRID_CONFIG.PADDING
      }),
    [positions, flatCards.length, cardSize]
  );

  // 드롭존 폭 계산 함수 (첫 번째 카드는 gap 없음)
  const getDropZoneWidth = useCallback(
    (index: number) =>
      calcDropZoneWidth({
        index,
        cardSize,
        gap: GRID_CONFIG.GAP,
        flatCardsLength: flatCards.length
      }),
    [cardSize, flatCards.length]
  );

  // 삽입선 위치 계산 함수 (카드 왼쪽 가장자리)
  const getInsertionLinePosition = useCallback(
    (index: number) =>
      calcInsertionLinePosition({
        index,
        positions,
        flatCardsLength: flatCards.length,
        cardSize,
        gap: GRID_CONFIG.GAP,
        padding: GRID_CONFIG.PADDING,
        insertionLineOffset: GRID_CONFIG.INSERTION_LINE_OFFSET
      }),
    [positions, flatCards.length, cardSize]
  );

  // DropZoneIndicator 위치 계산 (외부 파일 드래그 시 확장된 갭 영역 중앙)
  const dropZoneIndicatorPosition = useMemo(() => {
    if (activeDropIndexForFileUpload === null) return null;

    const { GAP, EXPANSION_OFFSET, DROP_INDICATOR_OFFSET } = GRID_CONFIG;
    const col = activeDropIndexForFileUpload % columns;

    // 현재 카드 위치 (확장된 상태)
    const currentCardPos = positions[activeDropIndexForFileUpload];
    if (!currentCardPos) return null;

    // 확장된 갭 영역의 너비 = 기본 GAP + EXPANSION_OFFSET
    const expandedGapWidth = GAP + EXPANSION_OFFSET;

    let indicatorX: number;

    if (col === 0) {
      // 첫 번째 칸: 카드 왼쪽에 배치 (갭 없음)
      indicatorX = currentCardPos.x - expandedGapWidth / 2;
    } else {
      // 이전 카드 위치 가져오기
      const prevCardPos = positions[activeDropIndexForFileUpload - 1];
      if (prevCardPos) {
        // 이전 카드 오른쪽 끝과 현재 카드 왼쪽 끝 사이의 중앙
        const prevCardRightX = prevCardPos.x + cardSize;
        const gapCenterX = (prevCardRightX + currentCardPos.x) / 2;
        indicatorX = gapCenterX - expandedGapWidth / 2 - DROP_INDICATOR_OFFSET;
      } else {
        indicatorX = currentCardPos.x - expandedGapWidth;
      }
    }

    return {
      x: indicatorX,
      y: currentCardPos.y,
      width: expandedGapWidth
    };
  }, [activeDropIndexForFileUpload, positions, columns, cardSize]);

  // 내부 카드 드래그 시 삽입선 위치 계산
  const cardDragInsertionIndex = useMemo(() => {
    if (isCardDragging && dragState.dropTargetFlatIndex !== null) {
      return dragState.dropTargetFlatIndex;
    }
    return null;
  }, [isCardDragging, dragState.dropTargetFlatIndex]);

  // 실제 렌더링할 카드와 업로드 중인 카드를 합친 배열 생성
  const renderItems = useMemo(
    () => mergeUploadingFiles({ flatCards, uploadingFiles }),
    [flatCards, uploadingFiles]
  );

  return (
    <>
      {/* 모든 파일의 썸네일 생성 */}
      {files.map((file) => (
        <FileThumbnails key={`thumbnails-${file.id}`} file={file} />
      ))}

      {/* 절대 좌표 기반 그리드 컨테이너 */}
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: containerHeight > 0 ? containerHeight : "auto" }}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
      >
        {/* ReorderDropZones - 통합 드래그 시스템 (flatCards 인덱스 사용) */}
        {isCardDragging &&
          flatCards.map((_, flatIndex) => {
            const dropZonePos = getDropZonePosition(flatIndex);
            return (
              <ReorderDropZone
                key={`dropzone-${flatIndex}`}
                index={flatIndex}
                isDragging={isCardDragging}
                draggedIndex={dragState.draggedFlatIndex}
                position={dropZonePos}
                height={cardHeight}
                width={getDropZoneWidth(flatIndex)}
                onDragOver={handleDropZoneDragOver}
                onDragLeave={handleDropZoneDragLeave}
                onDrop={handleDropZoneDrop}
              />
            );
          })}

        {/* 마지막 ReorderDropZone */}
        {isCardDragging && flatCards.length > 0 && (
          <ReorderDropZone
            index={flatCards.length}
            isDragging={isCardDragging}
            draggedIndex={dragState.draggedFlatIndex}
            position={getDropZonePosition(flatCards.length)}
            height={cardHeight}
            width={getDropZoneWidth(flatCards.length)}
            onDragOver={handleDropZoneDragOver}
            onDragLeave={handleDropZoneDragLeave}
            onDrop={handleDropZoneDrop}
          />
        )}

        {/* InsertionLine - 내부 카드 드래그 시 삽입 위치 표시 */}
        {cardDragInsertionIndex !== null && (
          <InsertionLine
            position={getInsertionLinePosition(cardDragInsertionIndex)}
            height={cardHeight}
            isActive={true}
          />
        )}

        {/* DropZoneIndicator - 외부 파일 드래그 시 CirclePlus 표시 */}
        {dropZoneIndicatorPosition && (
          <DropZoneIndicator
            position={{
              x: dropZoneIndicatorPosition.x,
              y: dropZoneIndicatorPosition.y
            }}
            height={cardHeight}
            width={dropZoneIndicatorPosition.width}
            isActive={isFileDragOver}
            isFileDragging={isFileDragOver}
            onDragOver={(e) =>
              handleFileDragOver(e as React.DragEvent<HTMLDivElement>)
            }
            onDragLeave={() => {
              // 컨테이너의 onDragLeave가 처리하므로 여기서는 no-op
            }}
            onDrop={(e) => handleFileDrop(e as React.DragEvent<HTMLDivElement>)}
          />
        )}

        {/* 카드 및 업로드 중인 파일 렌더링 */}
        {renderItems.map((item) => {
          const position = positions[item.positionIndex] ?? { x: 0, y: 0 };

          if (item.type === "uploading") {
            return (
              <div
                key={`uploading-${item.file.id}`}
                className="absolute transition-transform duration-200 ease-out"
                style={{
                  transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
                  width: cardSize,
                  height: cardHeight
                }}
              >
                <UploadingCard fileName={item.file.name} />
              </div>
            );
          }

          const card = item.card;
          const key =
            card.type === FLAT_CARD_TYPE.FILE ? card.file.id : card.page.id;
          const groupColor = getGroupColor(card.fileIndex);

          return (
            <GridItemWrapper
              key={key}
              position={position}
              cardWidth={cardSize}
              cardHeight={cardHeight}
            >
              {card.type === FLAT_CARD_TYPE.FILE ? (
                <DocumentCard
                  document={card.file}
                  groupId={card.groupId}
                  groupPageIds={card.groupPageIds}
                  imageSize={imageSize}
                  flatIndex={card.flatIndex}
                  isStacked={true}
                  isDragging={dragState.draggedFileId === card.file.id}
                  onPreview={onPreviewFile}
                  onDragStart={handleCardDragStart}
                  onDragEnd={handleCardDragEnd}
                />
              ) : (
                <ExpandedPageCard
                  fileId={card.file.id}
                  filePath={card.file.path}
                  page={card.page}
                  pageNumber={card.page.sourcePageIndex + 1}
                  flatIndex={card.flatIndex}
                  fileName={card.file.name}
                  imageSize={imageSize}
                  groupColor={groupColor}
                  groupId={card.groupId}
                  showCollapseButton={card.isFirstOfGroup}
                  isStacked={card.isFirstOfGroup}
                  isDragging={dragState.draggedFileId === card.file.id}
                  onDragStart={handleCardDragStart}
                  onDragEnd={handleCardDragEnd}
                  onPreview={onPreviewPage}
                />
              )}
            </GridItemWrapper>
          );
        })}
      </div>
    </>
  );
}
