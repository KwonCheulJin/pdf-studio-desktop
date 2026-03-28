import { useCallback } from "react";
import { Loader2, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button
} from "@/renderer/shared/ui";
import { VirtuosoPreviewList } from "@/renderer/features/pdf-preview/ui/virtuoso-preview-list";
import { useDownloadMergedFile } from "@/renderer/shared/hooks/use-download-merged-file";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

interface MergePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  mergedDocument: PdfDocument | null;
  isLoading: boolean;
}

/**
 * 선택 파일 병합 결과 미리보기 모달
 * - 병합 중: 로딩 스피너 표시
 * - 완료: VirtuosoPreviewList로 미리보기 + 다운로드 버튼
 */
export function MergePreviewModal({
  isOpen,
  onClose,
  mergedDocument,
  isLoading
}: MergePreviewModalProps) {
  const { download } = useDownloadMergedFile();

  const handleDownload = useCallback(async () => {
    if (!mergedDocument) return;
    const result = await download(mergedDocument);
    if (result.success) {
      await ipcClient.file.delete({ path: mergedDocument.path });
      onClose();
    }
  }, [mergedDocument, download, onClose]);

  const handleClose = useCallback(async () => {
    if (mergedDocument) {
      await ipcClient.file.delete({ path: mergedDocument.path });
    }
    onClose();
  }, [mergedDocument, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="flex h-[80vh] flex-col gap-0 p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 py-4">
          <DialogTitle className="text-sm font-medium">
            {isLoading
              ? "병합 중..."
              : `병합 결과 (${mergedDocument?.pageCount ?? 0}페이지)`}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={32} className="text-primary animate-spin" />
                <p className="text-muted-foreground text-sm">PDF 병합 중...</p>
              </div>
            </div>
          ) : mergedDocument ? (
            <VirtuosoPreviewList document={mergedDocument} isOpen={isOpen} />
          ) : null}
        </div>

        <DialogFooter className="border-border shrink-0 items-center justify-between border-t px-6 py-3">
          <span className="text-muted-foreground text-xs">
            {!isLoading && mergedDocument
              ? `${mergedDocument.pageCount}페이지`
              : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClose}>
              닫기
            </Button>
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={isLoading || !mergedDocument}
            >
              <Download size={14} className="mr-1" />
              다운로드
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
