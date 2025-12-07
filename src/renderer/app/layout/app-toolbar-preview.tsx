import { useState, useCallback } from "react";
import { ArrowLeft, Download } from "lucide-react";
import {
  Button,
  Tooltip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/renderer/shared/ui";
import {
  useMergeStore,
  useMergedDocument
} from "@/renderer/shared/model/merge-store";
import { MERGE_VIEW } from "@/renderer/shared/model/merge-state";
import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { useDownloadMergedFile } from "@/renderer/shared/hooks/use-download-merged-file";

export function AppToolbarPreview() {
  const mergedDocument = useMergedDocument();
  const setView = useMergeStore((state) => state.setView);
  const setMergedDocument = useMergeStore((state) => state.setMergedDocument);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const { download } = useDownloadMergedFile();
  const mergedFilePath = mergedDocument?.path ?? "";

  const deleteMergedFile = useCallback(async () => {
    if (!mergedFilePath) return;
    try {
      await ipcClient.file.delete({ path: mergedFilePath });
    } catch (error) {
      console.error("임시 병합 파일 삭제 실패", error);
    }
  }, [mergedFilePath]);

  const cleanupMergedFile = useCallback(async () => {
    await deleteMergedFile();
    setMergedDocument(null);
  }, [deleteMergedFile, setMergedDocument]);

  const handleDownload = async () => {
    if (!mergedDocument) return;
    const result = await download(mergedDocument);
    if (result.success) {
      await cleanupMergedFile();
      setView(MERGE_VIEW.WORKSPACE);
    }
  };

  const handleBack = useCallback(async () => {
    setIsConfirmOpen(false);
    await cleanupMergedFile();
    setView(MERGE_VIEW.WORKSPACE);
  }, [cleanupMergedFile, setView]);

  const handleRequestBack = () => {
    setIsConfirmOpen(true);
  };

  if (!mergedDocument) {
    return null;
  }

  return (
    <>
      <header className="border-border bg-card flex h-16 shrink-0 items-center justify-between border-b px-6">
        <Tooltip content="작업 공간으로 돌아가기" side="right">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestBack}
            aria-label="작업 공간으로 돌아가기"
          >
            <ArrowLeft size={24} />
          </Button>
        </Tooltip>
        <span className="text-foreground text-sm font-semibold">
          병합 결과 미리보기
        </span>
        <Tooltip content="병합된 PDF 저장">
          <Button onClick={handleDownload} disabled={!mergedDocument}>
            <Download size={18} />
            <span>다운로드</span>
          </Button>
        </Tooltip>
      </header>

      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle>작업 공간으로 돌아갈까요?</DialogTitle>
            <DialogDescription className="text-white">
              병합 결과 파일을 다운로드했는지 확인해주세요. <br />
              돌아가면 병합된 파일이 삭제됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsConfirmOpen(false)}>
              취소
            </Button>
            <Button onClick={handleBack}>돌아가기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
