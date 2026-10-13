import { useMemo } from "react";
import { countChanges } from "@/renderer/entities/comparison";
import {
  ChangeKindChips,
  ChangeList,
  ChangeNavigator,
  CompareNoticesBand,
  ConnectorToggle,
  useChangeFilter,
  useChangeKeyboard,
  useChangeNavigation,
  useCompletedComparison,
  ViewModeToggle
} from "@/renderer/features/pdf-compare";
import {
  CompareViewer,
  CurrentPageIndicator,
  ScrollSyncToggle,
  ZoomControls
} from "@/renderer/widgets/compare-viewer";

/**
 * 비교 결과 화면(시안 4, 계획서 P3-4). 머리는 앱 툴바(`AppToolbarCompare`)가 그린다.
 * 툴바(종류 칩·연결선·동기 스크롤·이전/다음·보기 방식·배율·현재 쪽) / 안내 띠 / 차이 목록 | 페이지 영역 |
 * 미니맵.
 */
export function CompareResultScreen() {
  const completed = useCompletedComparison();
  const filter = useChangeFilter();
  const navigation = useChangeNavigation();
  useChangeKeyboard({
    onPrevious: navigation.goPrevious,
    onNext: navigation.goNext
  });
  const counts = useMemo(
    () =>
      countChanges({
        changes: completed?.result.changes ?? [],
        filter
      }),
    [completed, filter]
  );
  if (!completed) return null;

  return (
    <div className="flex min-w-0 flex-1 flex-col text-sm/5.25">
      <div className="border-border bg-card flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 border-b px-6 py-2">
        <ChangeKindChips counts={counts} />
        <ConnectorToggle />
        <ScrollSyncToggle />
        <span className="grow" />
        <ChangeNavigator navigation={navigation} />
        <span className="grow" />
        <ViewModeToggle />
        <ZoomControls />
        <CurrentPageIndicator />
      </div>
      <CompareNoticesBand />
      <div className="flex min-h-0 flex-1">
        <ChangeList counts={counts} />
        <CompareViewer key={completed.jobId} completed={completed} />
      </div>
    </div>
  );
}
