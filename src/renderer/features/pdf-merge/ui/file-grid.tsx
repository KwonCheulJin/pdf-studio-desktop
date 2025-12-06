import { DocumentCard } from "@/renderer/entities/pdf-document";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

interface FileGridProps {
  files: PdfDocument[];
  onRemoveFile: (id: string) => void;
}

export function FileGrid({ files, onRemoveFile }: FileGridProps) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {files.map((file) => (
        <DocumentCard key={file.id} document={file} onRemove={onRemoveFile} />
      ))}
    </div>
  );
}
