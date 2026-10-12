import { useState, useCallback, type RefObject } from "react";
import { GRID_CONFIG } from "@/renderer/shared/constants/grid-layout";

/**
 * 드래그 데이터가 외부 파일인지 확인
 */
function isExternalFileDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files") && dataTransfer.files.length > 0;
}

export interface UploadingFile {
  id: string;
  name: string;
  insertIndex: number;
}

interface CalculateDropIndexParams {
  clientX: number;
  clientY: number;
  containerRect: DOMRect;
  scrollTop: number;
  columns: number;
  itemsCount: number;
  cardSize: number;
  cardHeight: number;
}

/**
 * 마우스 좌표를 기반으로 드롭 인덱스 계산
 */
function calculateDropIndex({
  clientX,
  clientY,
  containerRect,
  scrollTop,
  columns,
  itemsCount,
  cardSize,
  cardHeight
}: CalculateDropIndexParams): number {
  const { GAP, PADDING } = GRID_CONFIG;

  // 컨테이너 기준 상대 좌표 (스크롤 포함)
  const relX = clientX - containerRect.left;
  const relY = clientY - containerRect.top + scrollTop;

  // 열/행 계산 (카드 중앙 기준으로 반올림)
  const col = Math.round((relX - PADDING) / (cardSize + GAP));
  const row = Math.floor((relY - PADDING + GAP / 2) / (cardHeight + GAP));

  // 유효 범위 클램핑
  const clampedCol = Math.max(0, Math.min(col, columns));
  const clampedRow = Math.max(0, row);

  // 인덱스 계산
  const index = clampedRow * columns + clampedCol;

  return Math.max(0, Math.min(index, itemsCount));
}

interface UseFileDropZoneParams {
  /** 그리드 컨테이너 ref */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 현재 열 수 */
  columns: number;
  /** 현재 아이템 수 */
  itemsCount: number;
  /** 현재 카드 크기 (반응형) */
  cardSize: number;
  /** 현재 카드 높이 (반응형) */
  cardHeight: number;
}

interface UseFileDropZoneResult {
  isFileDragOver: boolean;
  activeDropIndex: number | null;
  uploadingFiles: UploadingFile[];
  handleFileDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleFileDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleFileDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  handleInsertHover: (index: number) => void;
  handleInsertLeave: () => void;
  handleInsertDrop: (e: React.DragEvent) => void;
}

/**
 * Adobe Acrobat 스타일의 파일 드롭 존 관리 훅
 * - 파일 드래그 시 마우스 좌표 기반으로 삽입 위치 계산
 * - 외부 파일 경로는 HTML5 drop 이벤트가 주지 않는다. 경로는 플랫폼 드롭 이벤트로 받는다.
 */
export function useFileDropZone({
  containerRef,
  columns,
  itemsCount,
  cardSize,
  cardHeight
}: UseFileDropZoneParams): UseFileDropZoneResult {
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [activeDropIndex, setActiveDropIndex] = useState<number | null>(null);
  // 외부 파일을 여는 동안 그리드에 보이는 자리표시
  const [uploadingFiles] = useState<UploadingFile[]>([]);

  // 전역 파일 드래그 오버 - 마우스 좌표 기반 인덱스 계산
  const handleFileDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (!isExternalFileDrag(e.dataTransfer)) return;

      setIsFileDragOver(true);

      // 컨테이너 rect 가져오기
      const container = containerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;

      // 마우스 좌표로 드롭 인덱스 계산
      const dropIndex = calculateDropIndex({
        clientX: e.clientX,
        clientY: e.clientY,
        containerRect,
        scrollTop,
        columns,
        itemsCount,
        cardSize,
        cardHeight
      });

      setActiveDropIndex(dropIndex);
    },
    [containerRef, columns, itemsCount, cardSize, cardHeight]
  );

  // 전역 파일 드래그 종료
  const handleFileDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsFileDragOver(false);
      setActiveDropIndex(null);
    },
    []
  );

  // 전역 드롭: 드래그 상태만 정리한다.
  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFileDragOver(false);
    setActiveDropIndex(null);
  }, []);

  // 삽입 인디케이터 호버 (DropIndicator에서 호출)
  const handleInsertHover = useCallback((index: number) => {
    setActiveDropIndex(index);
  }, []);

  // 삽입 인디케이터 호버 종료
  const handleInsertLeave = useCallback(() => {
    setActiveDropIndex(null);
  }, []);

  // 삽입 인디케이터 드롭: 드래그 상태만 정리한다.
  const handleInsertDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFileDragOver(false);
    setActiveDropIndex(null);
  }, []);

  return {
    isFileDragOver,
    activeDropIndex,
    uploadingFiles,
    handleFileDragOver,
    handleFileDragLeave,
    handleFileDrop,
    handleInsertHover,
    handleInsertLeave,
    handleInsertDrop
  };
}
