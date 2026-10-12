import {
  MERGE_STATUS,
  useMergeFiles,
  useTotalActivePages,
  useMergeStatus
} from "@/renderer/entities/merge-plan";
import { APP_STATUS } from "@/renderer/shared/constants";

export function AppStatusBar() {
  const files = useMergeFiles();
  // 삭제된(복원 대기) 페이지는 병합되지 않으므로 세지 않는다.
  const totalPages = useTotalActivePages();
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
