import { EmptyState, FileGrid } from "@/renderer/features/pdf-merge";
import { useMergeFiles, useMergeStore } from "@/renderer/shared/model/merge-store";

export function MergeWorkspace() {
  const files = useMergeFiles();
  const removeFile = useMergeStore((state) => state.removeFile);
  const hasFiles = files.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-auto p-6">
      {hasFiles ? (
        <FileGrid files={files} onRemoveFile={removeFile} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState />
        </div>
      )}
    </div>
  );
}
