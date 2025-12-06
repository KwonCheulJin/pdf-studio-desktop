import { Plus, FolderPlus, Settings } from "lucide-react";
import { Button } from "@/renderer/shared/ui";
import { useMergeFiles, useMergeStore } from "@/renderer/shared/model/merge-store";
import { createPdfDocument } from "@/renderer/shared/model/pdf-document";

export function AppToolbar() {
  const files = useMergeFiles();
  const addFiles = useMergeStore((state) => state.addFiles);
  const hasFiles = files.length > 0;

  const handleAddFiles = async () => {
    // TODO: Implement file dialog via IPC
    // For now, add mock data for testing
    const mockDocument = createPdfDocument(
      `/mock/document_${Date.now()}.pdf`,
      Math.floor(Math.random() * 10) + 1
    );
    addFiles([mockDocument]);
  };

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-2">
        <Button onClick={handleAddFiles}>
          <Plus size={18} />
          <span>파일 추가</span>
        </Button>
        <Button variant="outline">
          <FolderPlus size={18} />
          <span>폴더 추가</span>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon">
          <Settings size={20} />
        </Button>
        <Button disabled={!hasFiles}>병합</Button>
      </div>
    </header>
  );
}
