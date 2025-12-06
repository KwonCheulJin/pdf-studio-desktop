import { useState, useCallback } from "react";
import { useMergeStore } from "@/renderer/shared/model/merge-store";
import { createPdfDocument } from "@/renderer/shared/model/pdf-document";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { ACCEPTED_FILE_TYPES } from "@/renderer/shared/constants/app";

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
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => Promise<void>;
}

/**
 * 드래그 앤 드롭으로 파일 추가를 관리하는 훅
 */
export function useDroppedFiles(): UseDroppedFilesResult {
  const [isDragOver, setIsDragOver] = useState(false);
  const addFiles = useMergeStore((state) => state.addFiles);

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

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      // 외부 파일 드롭이 아니면 무시 (내부 카드 드래그)
      if (!isExternalFileDrag(e.dataTransfer)) return;

      const droppedFiles = getFilesFromDataTransfer(e.dataTransfer);
      if (droppedFiles.length === 0) return;

      const documentsOrNull = await Promise.all(
        droppedFiles.map(async (file) => {
          const filePath = ipcClient.file.getPath(file);
          if (!filePath) {
            console.warn("파일 경로를 가져올 수 없습니다:", file.name);
            return null;
          }
          try {
            const pdfInfo = await ipcClient.meta.getPdfInfo(filePath);
            return createPdfDocument(
              filePath,
              pdfInfo.pageCount,
              pdfInfo.title
            );
          } catch {
            // 메타데이터 가져오기 실패 시 기본값 사용
            return createPdfDocument(filePath, 1);
          }
        })
      );

      const documents = documentsOrNull.filter(
        (doc): doc is NonNullable<typeof doc> => doc !== null
      );

      if (documents.length > 0) {
        addFiles(documents);
      }
    },
    [addFiles]
  );

  return {
    isDragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}
