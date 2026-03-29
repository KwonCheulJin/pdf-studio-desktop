import {
  useMergeFiles,
  useTotalPages,
  useMergeStatus
} from "@/renderer/shared/model/merge-store";
import { MERGE_STATUS } from "@/renderer/shared/model/merge-state";
import { APP_STATUS } from "@/renderer/shared/constants";

export function AppStatusBar() {
  const files = useMergeFiles();
  const totalPages = useTotalPages();
  const status = useMergeStatus();

  const statusText = (() => {
    switch (status) {
      case MERGE_STATUS.MERGING:
        return APP_STATUS.PROCESSING;
      case MERGE_STATUS.COMPLETE:
        return APP_STATUS.COMPLETE;
      case MERGE_STATUS.ERROR:
        return APP_STATUS.ERROR;
      default:
        return APP_STATUS.READY;
    }
  })();

  return (
    <footer className="border-border bg-background flex h-10 shrink-0 items-center justify-between border-t px-6">
      <p className="text-muted-foreground text-sm">
        전체 파일: {files.length}
        <span className="mx-2">|</span>
        전체 페이지: {totalPages}
      </p>
      <div className="text-muted-foreground flex items-center gap-3 text-sm">
        <span>상태: {statusText}</span>
        <span className="text-muted-foreground/50">|</span>
        <span>v{__APP_VERSION__}</span>
      </div>
    </footer>
  );
}
