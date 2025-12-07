import { ArrowLeft } from "lucide-react";
import { VirtuosoPreviewList } from "@/renderer/features/pdf-preview/ui/virtuoso-preview-list";
import {
  useMergeStore,
  useMergedDocument
} from "@/renderer/shared/model/merge-store";
import { MERGE_VIEW } from "@/renderer/shared/model/merge-state";
import { Button } from "@/renderer/shared/ui";

export function MergedPreviewPage() {
  const mergedDocument = useMergedDocument();
  const setView = useMergeStore((state) => state.setView);

  if (!mergedDocument) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">병합된 문서가 없습니다.</p>
      </div>
    );
  }

  const handleBack = () => {
    setView(MERGE_VIEW.WORKSPACE);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-border bg-card flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label="작업 공간으로 돌아가기"
          >
            <ArrowLeft size={18} />
          </Button>
          <div className="flex flex-col">
            <span className="text-foreground text-sm font-semibold">
              {mergedDocument.name}
            </span>
            <span className="text-muted-foreground text-xs">
              총 {mergedDocument.pageCount}페이지
            </span>
          </div>
        </div>
        <p className="text-muted-foreground text-right text-xs">
          {mergedDocument.path}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <VirtuosoPreviewList document={mergedDocument} isOpen />
      </div>
    </div>
  );
}
