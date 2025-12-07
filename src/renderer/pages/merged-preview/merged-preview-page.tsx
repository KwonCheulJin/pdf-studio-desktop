import { VirtuosoPreviewList } from "@/renderer/features/pdf-preview/ui/virtuoso-preview-list";
import { useMergedDocument } from "@/renderer/shared/model/merge-store";

export function MergedPreviewPage() {
  const mergedDocument = useMergedDocument();

  if (!mergedDocument) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">병합된 문서가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="border-border bg-card flex items-center justify-between border-b px-8 py-4">
        <div className="flex items-center gap-2">
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
          임시 저장 위치: {mergedDocument.path}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-6">
        <VirtuosoPreviewList document={mergedDocument} isOpen />
      </div>
    </div>
  );
}
