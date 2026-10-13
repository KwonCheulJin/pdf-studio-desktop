import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates
} from "@dnd-kit/sortable";
import {
  useMergeStore,
  useMergeOrder,
  useCollapsedGroups,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import { useResponsiveGridLayout } from "@/renderer/shared/lib/use-responsive-grid-layout";
import {
  calculateDropIndex,
  type GridPosition
} from "@/renderer/shared/lib/layout-calculator";
import { getGroupColorClass } from "@/renderer/shared/config/theme";
import { GRID_CONFIG } from "@/renderer/shared/constants/grid-layout";
import { GridItemWrapper, DropZoneIndicator } from "@/renderer/shared/ui";
import { useFileDropZone } from "../model/use-file-drop-zone";
import { useCardSize } from "../model/zoom-store";
import { useCardSelection } from "../model/use-card-selection";
import { flattenFileGrid, type FlatCard } from "../lib/flatten-file-grid";
import {
  mergeUploadingFiles,
  RENDER_ITEM_TYPE
} from "../lib/merge-uploading-files";
import { getCardLabel, getCardSortId, resolveCardMove } from "../lib/card-move";
import {
  createReorderAnnouncements,
  REORDER_INSTRUCTIONS
} from "../lib/reorder-announcements";
import { FLAT_CARD_TYPE } from "../config/flat-card";
import { DocumentCard } from "./document-card";
import { ExpandedPageCard } from "./expanded-page-card";
import { SortableCard } from "./sortable-card";
import { UploadingCard } from "./uploading-card";

/** 이만큼 움직여야 포인터 드래그가 시작된다. 카드 안 버튼·체크박스 클릭과 구분한다. */
const POINTER_ACTIVATION_DISTANCE_PX = 5;

interface FileGridProps {
  files: PdfDocument[];
  onPreviewFile: (document: PdfDocument, groupPageIds: string[]) => void;
  onPreviewPage: (fileId: string, pageIndex: number) => void;
  /** 카드를 집었는지(포인터·키보드). 집는 동안 선택 단축키를 끈다. */
  onReorderingChange: (isReordering: boolean) => void;
}

export function FileGrid({
  files,
  onPreviewFile,
  onPreviewPage,
  onReorderingChange
}: FileGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const mergeOrder = useMergeOrder();
  const collapsedGroups = useCollapsedGroups();
  const insertFileAtPosition = useMergeStore(
    (state) => state.insertFileAtPosition
  );
  const movePageInMergeOrder = useMergeStore(
    (state) => state.movePageInMergeOrder
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

  const sortIds = useMemo(() => flatCards.map(getCardSortId), [flatCards]);
  const handleCardClick = useCardSelection(flatCards);

  const accessibility = useMemo(
    () => ({
      announcements: createReorderAnnouncements({
        sortIds,
        labels: new Map(
          flatCards.map((card) => [getCardSortId(card), getCardLabel(card)])
        )
      }),
      screenReaderInstructions: REORDER_INSTRUCTIONS
    }),
    [flatCards, sortIds]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: POINTER_ACTIVATION_DISTANCE_PX }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const handleDragStart = useCallback(() => {
    onReorderingChange(true);
  }, [onReorderingChange]);

  const handleDragCancel = useCallback(() => {
    onReorderingChange(false);
  }, [onReorderingChange]);

  // 카드를 집은 채로 그리드가 사라지면(전체 삭제 등) dnd-kit은 끝·취소 이벤트를 보내지 않는다.
  useEffect(
    () => () => {
      onReorderingChange(false);
    },
    [onReorderingChange]
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      onReorderingChange(false);
      if (!over) return;
      const move = resolveCardMove({
        flatCards,
        activeIndex: sortIds.indexOf(String(active.id)),
        overIndex: sortIds.indexOf(String(over.id))
      });
      if (!move) return;
      if (move.type === FLAT_CARD_TYPE.FILE) {
        insertFileAtPosition({
          fileId: move.fileId,
          targetPageId: move.targetPageId
        });
      } else {
        movePageInMergeOrder({
          pageId: move.pageId,
          targetPageId: move.targetPageId
        });
      }
    },
    [
      flatCards,
      sortIds,
      insertFileAtPosition,
      movePageInMergeOrder,
      onReorderingChange
    ]
  );

  // 카드만 놓은 기본 레이아웃 (드롭 자리 계산용)
  const {
    columns,
    cardWidth,
    cardHeight,
    imageSize,
    positions: cardPositions
  } = useResponsiveGridLayout({
    itemsCount: flatCards.length,
    viewportWidth: containerWidth,
    userCardSize
  });

  const resolveDropIndex = (point: GridPosition): number =>
    calculateDropIndex({
      point,
      positions: cardPositions,
      cardWidth,
      cardHeight,
      gap: GRID_CONFIG.GAP
    });

  // 창 밖에서 끌어온 파일
  const { activeDropIndex, uploadingFiles } = useFileDropZone({
    containerRef,
    resolveDropIndex,
    flatCards
  });

  // 최종 레이아웃 (업로드 중인 파일 포함 + 파일 드래그 시 갭 확장)
  const { positions, containerHeight } = useResponsiveGridLayout({
    itemsCount: flatCards.length + uploadingFiles.length,
    viewportWidth: containerWidth,
    activeDropIndex,
    userCardSize
  });

  // DropZoneIndicator 위치 계산 (외부 파일 드래그 시 확장된 갭 영역 중앙)
  const dropZoneIndicatorPosition = useMemo(() => {
    if (activeDropIndex === null) return null;

    const { GAP, EXPANSION_OFFSET, DROP_INDICATOR_OFFSET } = GRID_CONFIG;
    const column = activeDropIndex % columns;

    // 현재 카드 위치 (확장된 상태)
    const currentCardPos = positions[activeDropIndex];
    if (!currentCardPos) return null;

    // 확장된 갭 영역의 너비 = 기본 GAP + EXPANSION_OFFSET
    const expandedGapWidth = GAP + EXPANSION_OFFSET;

    let indicatorX: number;

    if (column === 0) {
      // 첫 번째 칸: 카드 왼쪽에 배치 (갭 없음)
      indicatorX = currentCardPos.x - expandedGapWidth / 2;
    } else {
      // 이전 카드 위치 가져오기
      const prevCardPos = positions[activeDropIndex - 1];
      if (prevCardPos) {
        // 이전 카드 오른쪽 끝과 현재 카드 왼쪽 끝 사이의 중앙
        const prevCardRightX = prevCardPos.x + cardWidth;
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
  }, [activeDropIndex, positions, columns, cardWidth]);

  // 실제 렌더링할 카드와 업로드 중인 카드를 합친 배열 생성
  const renderItems = useMemo(
    () => mergeUploadingFiles({ flatCards, uploadingFiles }),
    [flatCards, uploadingFiles]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={accessibility}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={sortIds} strategy={rectSortingStrategy}>
        {/* 절대 좌표 기반 그리드 컨테이너 */}
        <div
          ref={containerRef}
          className="relative w-full"
          style={{ height: containerHeight > 0 ? containerHeight : "auto" }}
        >
          {/* DropZoneIndicator - 외부 파일 드래그 시 CirclePlus 표시 */}
          {dropZoneIndicatorPosition && (
            <DropZoneIndicator
              position={{
                x: dropZoneIndicatorPosition.x,
                y: dropZoneIndicatorPosition.y
              }}
              height={cardHeight}
              width={dropZoneIndicatorPosition.width}
            />
          )}

          {/* 카드 및 업로드 중인 파일 렌더링 */}
          {renderItems.map((item) => {
            const position = positions[item.positionIndex] ?? { x: 0, y: 0 };

            if (item.type === RENDER_ITEM_TYPE.UPLOADING) {
              return (
                <GridItemWrapper
                  key={`uploading-${item.file.id}`}
                  position={position}
                  cardWidth={cardWidth}
                  cardHeight={cardHeight}
                >
                  <UploadingCard fileName={item.file.name} />
                </GridItemWrapper>
              );
            }

            const card = item.card;
            const sortId = getCardSortId(card);
            const groupColor = getGroupColorClass({ index: card.fileIndex });

            return (
              <SortableCard
                key={sortId}
                id={sortId}
                label={getCardLabel(card)}
                position={position}
                cardWidth={cardWidth}
                cardHeight={cardHeight}
                onClick={(event) => handleCardClick({ card, event })}
              >
                {card.type === FLAT_CARD_TYPE.FILE ? (
                  <DocumentCard
                    document={card.file}
                    groupId={card.groupId}
                    groupPageIds={card.groupPageIds}
                    deletedPageCount={card.deletedPageCount}
                    imageSize={imageSize}
                    isStacked={true}
                    onPreview={onPreviewFile}
                  />
                ) : (
                  <ExpandedPageCard
                    fileId={card.file.id}
                    filePath={card.file.path}
                    page={card.page}
                    pageNumber={card.page.sourcePageIndex + 1}
                    fileName={card.file.name}
                    imageSize={imageSize}
                    groupColor={groupColor}
                    groupId={card.groupId}
                    showCollapseButton={card.isFirstOfGroup}
                    isStacked={card.isFirstOfGroup}
                    onPreview={onPreviewPage}
                  />
                )}
              </SortableCard>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
