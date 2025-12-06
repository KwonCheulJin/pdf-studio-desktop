import { useState, useCallback } from "react";
import { Download } from "lucide-react";
import {
  EmptyState,
  FileGrid,
  FloatingActionBar
} from "@/renderer/features/pdf-merge";
import { PreviewModal } from "@/renderer/features/pdf-preview";
import { useMergeFiles } from "@/renderer/shared/model/merge-store";
import {
  useSelectionStore,
  useSelectedCount,
  useSelectionType
} from "@/renderer/shared/model/selection-store";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";
import {
  PREVIEW_MODE,
  type PreviewTarget
} from "@/renderer/shared/constants/preview";
import { usePageRotation } from "@/renderer/shared/hooks/use-page-rotation";
import { useSelectionActions } from "@/renderer/shared/hooks/use-selection-actions";
import { useDroppedFiles } from "../model/use-dropped-files";

export function MergeWorkspace() {
  const files = useMergeFiles();
  const hasFiles = files.length > 0;

  // 미리보기 모달 상태
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(
    null
  );
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // 선택 상태 관리 (FloatingActionBar용)
  const selectedCount = useSelectedCount();
  const selectionType = useSelectionType();
  const { clearSelection } = useSelectionStore();

  // FloatingActionBar에서 사용하는 훅
  const { handleRotateSelectedCw, handleRotateSelectedCcw } =
    usePageRotation(files);
  const { handleDeleteSelected } = useSelectionActions(files);

  // EmptyState용 드래그 앤 드롭 (파일이 없을 때만 사용)
  const {
    isDragOver: isEmptyDragOver,
    handleDragOver: handleEmptyDragOver,
    handleDragLeave: handleEmptyDragLeave,
    handleDrop: handleEmptyDrop
  } = useDroppedFiles();

  // 미리보기 열기/닫기
  const handlePreviewFile = useCallback((document: PdfDocument) => {
    setPreviewTarget({
      mode: PREVIEW_MODE.DOCUMENT,
      document
    });
    setIsPreviewOpen(true);
  }, []);

  const handlePreviewPage = useCallback(
    (fileId: string, pageIndex: number) => {
      const document = files.find((f) => f.id === fileId);
      if (!document) return;

      setPreviewTarget({
        mode: PREVIEW_MODE.PAGE,
        document,
        initialPageIndex: pageIndex
      });
      setIsPreviewOpen(true);
    },
    [files]
  );

  const handleClosePreview = useCallback(() => {
    setIsPreviewOpen(false);
    setPreviewTarget(null);
  }, []);

  return (
    <div
      className={`flex flex-1 flex-col overflow-auto py-6 transition-colors ${
        !hasFiles && isEmptyDragOver ? "bg-primary/5" : ""
      }`}
      onDragOver={!hasFiles ? handleEmptyDragOver : undefined}
      onDragLeave={!hasFiles ? handleEmptyDragLeave : undefined}
      onDrop={!hasFiles ? handleEmptyDrop : undefined}
    >
      {hasFiles ? (
        <FileGrid
          files={files}
          onPreviewFile={handlePreviewFile}
          onPreviewPage={handlePreviewPage}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState />
        </div>
      )}
      {/* 파일이 없을 때만 전체 오버레이 표시 */}
      {isEmptyDragOver && !hasFiles && (
        <div className="border-primary bg-background/80 pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-dashed backdrop-blur-sm">
          <div className="bg-card flex flex-col items-center gap-4 rounded-xl p-10 shadow-2xl">
            <div className="bg-primary/10 text-primary flex h-16 w-16 items-center justify-center rounded-full">
              <Download size={32} />
            </div>
            <p className="text-foreground text-xl font-bold">
              여기에 파일을 놓으세요
            </p>
            <p className="text-muted-foreground text-sm">
              PDF, TIF, TIFF 파일을 추가합니다
            </p>
          </div>
        </div>
      )}

      {/* Floating Action Bar */}
      <FloatingActionBar
        selectedCount={selectedCount}
        selectionType={selectionType}
        hasFiles={hasFiles}
        onDelete={handleDeleteSelected}
        onRotateCw={handleRotateSelectedCw}
        onRotateCcw={handleRotateSelectedCcw}
        onClearSelection={clearSelection}
      />

      {/* 미리보기 모달 */}
      <PreviewModal
        isOpen={isPreviewOpen}
        onClose={handleClosePreview}
        target={previewTarget}
      />
    </div>
  );
}
