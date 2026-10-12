import { useState, useCallback } from "react";

/**
 * 드래그 데이터가 외부 파일인지 확인
 * - 외부 파일: dataTransfer.types에 'Files'가 포함됨
 * - 내부 카드 드래그: 'Files'가 없고 'text/plain' 등만 포함
 */
function isExternalFileDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files");
}

interface UseDroppedFilesResult {
  isDragOver: boolean;
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}

/**
 * 빈 작업 공간의 외부 파일 드래그 표시를 관리하는 훅
 * - 외부 파일 경로는 HTML5 drop 이벤트가 주지 않는다. 경로는 플랫폼 드롭 이벤트로 받는다.
 */
export function useDroppedFiles(): UseDroppedFilesResult {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // 외부 파일 드래그일 때만 드롭 영역 표시
    if (isExternalFileDrag(e.dataTransfer)) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  return {
    isDragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}
