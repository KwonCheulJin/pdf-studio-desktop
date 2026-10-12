import { useState, useCallback } from "react";
import { Download } from "lucide-react";
import {
  MERGE_STATUS,
  useMergeFiles,
  useMergeStatus,
  type PdfDocument
} from "@/renderer/entities/merge-plan";
import {
  EmptyState,
  FileGrid,
  useSelectionStore,
  useSelectedCount,
  useSelectionType,
  usePageRotation,
  useSelectionActions,
  useSelectedMerge,
  useSelectAll,
  useSelectionShortcuts,
  useDeselectDeleted
} from "@/renderer/features/pdf-merge";
import {
  PreviewModal,
  PREVIEW_MODE,
  type PreviewTarget
} from "@/renderer/features/pdf-preview";
import { useDroppedFiles } from "../model/use-dropped-files";
import { FloatingActionBar } from "./floating-action-bar";
import { MergePreviewModal } from "./merge-preview-modal";

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
  const { handleDeleteSelected, hasDeletedInSelection, handleRestoreSelected } =
    useSelectionActions(files);

  // 선택 파일 병합
  const [isMergePreviewOpen, setIsMergePreviewOpen] = useState(false);
  const {
    startSelectedMerge,
    isSelectedMerging,
    selectedMergedDocument,
    clearSelectedMerge
  } = useSelectedMerge();

  const handleMergeSelected = useCallback(async () => {
    setIsMergePreviewOpen(true);
    const isMerged = await startSelectedMerge();
    if (!isMerged) setIsMergePreviewOpen(false);
  }, [startSelectedMerge]);

  const handleCloseMergePreview = useCallback(() => {
    setIsMergePreviewOpen(false);
    clearSelectedMerge();
  }, [clearSelectedMerge]);

  // 어떤 경로로든 지워진 파일·페이지는 선택에서 뺀다
  useDeselectDeleted();

  // 선택 단축키 (모달·병합 진행/실패 오버레이·카드 집기 중에는 끈다)
  const [isReordering, setIsReordering] = useState(false);
  const mergeStatus = useMergeStatus();
  const isMergeOverlayOpen =
    mergeStatus === MERGE_STATUS.MERGING || mergeStatus === MERGE_STATUS.ERROR;
  const { selectAllItems } = useSelectAll();
  useSelectionShortcuts({
    isEnabled:
      hasFiles &&
      !isPreviewOpen &&
      !isMergePreviewOpen &&
      !isMergeOverlayOpen &&
      !isReordering,
    onDelete: handleDeleteSelected,
    onSelectAll: selectAllItems,
    onClearSelection: clearSelection
  });

  // EmptyState용 파일 드롭 (파일이 없을 때만 사용)
  const { isDragOver: isEmptyDragOver } = useDroppedFiles({
    isEnabled: !hasFiles
  });

  // 미리보기 열기/닫기
  const handlePreviewFile = useCallback(
    (document: PdfDocument, groupPageIds: string[]) => {
      setPreviewTarget({
        mode: PREVIEW_MODE.DOCUMENT,
        document,
        groupPageIds
      });
      setIsPreviewOpen(true);
    },
    []
  );

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
        isEmptyDragOver ? "bg-primary/5" : ""
      }`}
    >
      {hasFiles ? (
        <FileGrid
          files={files}
          onPreviewFile={handlePreviewFile}
          onPreviewPage={handlePreviewPage}
          onReorderingChange={setIsReordering}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState />
        </div>
      )}
      {/* 파일이 없을 때만 전체 오버레이 표시 */}
      {isEmptyDragOver && (
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
        hasDeletedInSelection={hasDeletedInSelection}
        onDelete={handleDeleteSelected}
        onRestore={handleRestoreSelected}
        onRotateCw={handleRotateSelectedCw}
        onRotateCcw={handleRotateSelectedCcw}
        onClearSelection={clearSelection}
        onMergeSelected={handleMergeSelected}
      />

      {/* 미리보기 모달 */}
      <PreviewModal
        isOpen={isPreviewOpen}
        onClose={handleClosePreview}
        target={previewTarget}
      />

      {/* 선택 파일 병합 미리보기 모달 */}
      <MergePreviewModal
        isOpen={isMergePreviewOpen}
        onClose={handleCloseMergePreview}
        mergedDocument={selectedMergedDocument}
        isLoading={isSelectedMerging}
      />
    </div>
  );
}
