import { useState, useCallback, type RefObject } from "react";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import { GRID_CONFIG } from "@/renderer/shared/constants/grid-layout";
import { ACCEPTED_FILE_TYPES } from "@/renderer/shared/constants/app";
import { loadDroppedFiles } from "@/renderer/shared/lib/load-dropped-files";

function isAllowedFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  return ACCEPTED_FILE_TYPES.includes(
    ext as (typeof ACCEPTED_FILE_TYPES)[number]
  );
}

function getFilesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files).filter((file) =>
    isAllowedFile(file.name)
  );
}

/**
 * 드래그 데이터가 외부 파일인지 확인
 */
function isExternalFileDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files");
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
  handleFileDrop: (e: React.DragEvent<HTMLDivElement>) => Promise<void>;
  handleInsertHover: (index: number) => void;
  handleInsertLeave: () => void;
  handleInsertDrop: (e: React.DragEvent, index: number) => Promise<void>;
}

/**
 * Adobe Acrobat 스타일의 파일 드롭 존 관리 훅
 * - 파일 드래그 시 마우스 좌표 기반으로 삽입 위치 계산
 * - 특정 위치에 파일 삽입 가능
 * - 업로드 중 로딩 상태 표시
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
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  const addFiles = useMergeStore((state) => state.addFiles);
  const insertFiles = useMergeStore((state) => state.insertFiles);

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

  // 전역 드롭 (계산된 인덱스에 삽입)
  const handleFileDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const currentDropIndex = activeDropIndex;
      setIsFileDragOver(false);
      setActiveDropIndex(null);

      if (!isExternalFileDrag(e.dataTransfer)) return;

      const droppedFiles = getFilesFromDataTransfer(e.dataTransfer);
      if (droppedFiles.length === 0) return;

      // 삽입 인덱스 결정 (null이면 마지막에 추가)
      const insertIndex = currentDropIndex ?? itemsCount;

      // 로딩 상태 추가
      const uploadIds = droppedFiles.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        insertIndex
      }));
      setUploadingFiles((prev) => [...prev, ...uploadIds]);

      const documents = await loadDroppedFiles(droppedFiles);

      if (documents.length > 0) {
        if (insertIndex >= itemsCount) {
          // 마지막에 추가
          addFiles(documents);
        } else {
          // 특정 위치에 삽입
          insertFiles(insertIndex, documents);
        }
      }

      // 로딩 상태 제거
      setUploadingFiles((prev) =>
        prev.filter(
          (uploadingFile) =>
            !uploadIds.some((uploadId) => uploadId.id === uploadingFile.id)
        )
      );
    },
    [activeDropIndex, itemsCount, addFiles, insertFiles]
  );

  // 삽입 인디케이터 호버 (DropIndicator에서 호출)
  const handleInsertHover = useCallback((index: number) => {
    setActiveDropIndex(index);
  }, []);

  // 삽입 인디케이터 호버 종료
  const handleInsertLeave = useCallback(() => {
    setActiveDropIndex(null);
  }, []);

  // 특정 위치에 파일 삽입 (DropIndicator에서 호출)
  const handleInsertDrop = useCallback(
    async (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      setIsFileDragOver(false);
      setActiveDropIndex(null);

      if (!isExternalFileDrag(e.dataTransfer)) return;

      const droppedFiles = getFilesFromDataTransfer(e.dataTransfer);
      if (droppedFiles.length === 0) return;

      // 로딩 상태 추가
      const uploadIds = droppedFiles.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        insertIndex: index
      }));
      setUploadingFiles((prev) => [...prev, ...uploadIds]);

      const documents = await loadDroppedFiles(droppedFiles);

      if (documents.length > 0) {
        insertFiles(index, documents);
      }

      // 로딩 상태 제거
      setUploadingFiles((prev) =>
        prev.filter(
          (uploadingFile) =>
            !uploadIds.some((uploadId) => uploadId.id === uploadingFile.id)
        )
      );
    },
    [insertFiles]
  );

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
