import { X, FileText } from "lucide-react";
import { cn } from "@/renderer/shared/lib/utils";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

interface DocumentCardProps {
  document: PdfDocument;
  onRemove?: (id: string) => void;
}

export function DocumentCard({ document, onRemove }: DocumentCardProps) {
  const thumbnailCount = Math.min(document.pageCount, 3);

  const handleRemove = (event: React.MouseEvent) => {
    event.stopPropagation();
    onRemove?.(document.id);
  };

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-3 transition-shadow hover:shadow-lg">
      {/* 삭제 버튼 */}
      <button
        type="button"
        onClick={handleRemove}
        className="absolute right-2 top-2 z-10 hidden rounded-full bg-black/50 p-1 text-white/80 hover:bg-black/70 hover:text-white group-hover:block"
        aria-label="파일 삭제"
      >
        <X size={14} />
      </button>

      {/* 썸네일 */}
      <div className="flex h-28 w-full gap-1">
        {Array.from({ length: thumbnailCount }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "h-full rounded-sm bg-muted",
              thumbnailCount === 1 && "w-full",
              thumbnailCount === 2 && "w-1/2",
              thumbnailCount === 3 && "w-1/3"
            )}
          >
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <FileText size={24} />
            </div>
          </div>
        ))}
      </div>

      {/* 파일 정보 */}
      <div>
        <p
          className="truncate text-sm font-medium text-foreground"
          title={document.name}
        >
          {document.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {document.pageCount}페이지
        </p>
      </div>
    </div>
  );
}
