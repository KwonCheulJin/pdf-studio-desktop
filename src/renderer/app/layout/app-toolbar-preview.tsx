import { Download } from "lucide-react";
import { Button, Tooltip } from "@/renderer/shared/ui";
import { useMergedDocument } from "@/renderer/shared/model/merge-store";
import { useDownloadMergedFile } from "@/renderer/shared/hooks/use-download-merged-file";

export function AppToolbarPreview() {
  const mergedDocument = useMergedDocument();
  const { download } = useDownloadMergedFile();

  const handleDownload = async () => {
    if (!mergedDocument) return;
    await download(mergedDocument);
  };

  return (
    <header className="border-border bg-card flex h-16 shrink-0 items-center justify-between border-b px-6">
      <div />
      <div className="text-foreground text-sm font-semibold">
        병합 결과 미리보기
      </div>
      <Tooltip content="병합된 PDF 저장">
        <Button onClick={handleDownload} disabled={!mergedDocument}>
          <Download size={18} />
          <span>다운로드</span>
        </Button>
      </Tooltip>
    </header>
  );
}
