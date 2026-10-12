import { Loader2 } from "lucide-react";
import { useMergeProgress, useMergeStatus } from "../model/merge-store";
import { MERGE_STATUS } from "../model/merge-state";

export function MergeProgressOverlay() {
  const status = useMergeStatus();
  const progress = useMergeProgress();

  if (status !== MERGE_STATUS.MERGING) return null;

  return (
    <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      <div className="bg-card flex min-w-[280px] flex-col items-center gap-3 rounded-2xl px-8 py-7 shadow-2xl">
        <Loader2 className="text-primary h-10 w-10 animate-spin" />
        <p className="text-foreground text-base font-semibold">
          PDF 병합 중...
        </p>
        <p className="text-muted-foreground text-sm">{progress}% 완료</p>
      </div>
    </div>
  );
}
