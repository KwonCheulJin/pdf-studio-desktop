import { useMemo } from "react";
import {
  CompareExportDialog,
  type ExportComparison
} from "@/renderer/features/compare-export";
import {
  COMPARE_SLOT,
  useChangeFilter,
  useCompletedComparison
} from "@/renderer/features/pdf-compare";

/**
 * 결과 머리의 "내보내기"(시안 5): 비교 세션의 마지막 결과·두 문서와 결과 화면 필터를 내보내기 모달에
 * 넘긴다(같은 레이어의 두 기능을 여기서 잇는다).
 */
export function CompareExportAction() {
  const completed = useCompletedComparison();
  const filter = useChangeFilter();
  const comparison = useMemo<ExportComparison | null>(() => {
    if (!completed) return null;
    const { files, result } = completed;
    const before = files[COMPARE_SLOT.BEFORE];
    const after = files[COMPARE_SLOT.AFTER];
    return {
      result,
      before: { path: before.path, name: before.name },
      after: { path: after.path, name: after.name }
    };
  }, [completed]);
  if (!comparison) return null;
  return (
    <CompareExportDialog
      comparison={comparison}
      hiddenKinds={filter.hiddenKinds}
      isReviewHidden={filter.isReviewHidden}
    />
  );
}
