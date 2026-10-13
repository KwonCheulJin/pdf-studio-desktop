import { useId, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  BADGE_TONE,
  groupByRow,
  indexPagePairs,
  isChangeVisible,
  numberChanges,
  pairOcrLabel,
  pairPagesLabel,
  TextBadge,
  type ChangeCounts,
  type ChangeGroup,
  type CompareResult
} from "@/renderer/entities/comparison";
import { Button, Checkbox } from "@/renderer/shared/ui";
import {
  COMPARE_RESULT_TEXT,
  compareResultMessage
} from "../config/compare-result";
import { useHoveredChangeIds } from "../model/change-hover-store";
import {
  useActiveChangeId,
  useChangeFilter,
  useCompareSessionStore,
  useCompletedComparison
} from "../model/compare-session-store";
import { ChangeListItem } from "./change-list-item";

const PANEL_ICON_SIZE = 16;
const EMPTY_ICON_SIZE = 20;

const PANEL_BUTTON_CLASS =
  "text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none";

interface ChangeGroupSectionProps {
  group: ChangeGroup;
  result: CompareResult;
  activeChangeId: string | null;
  hoveredChangeIds: readonly string[];
  onSelect: (changeId: string) => void;
}

/** 쪽 묶음 하나: 머리("2쪽 · 2건", OCR 쪽이면 배지) + 항목 */
function ChangeGroupSection({
  group,
  result,
  activeChangeId,
  hoveredChangeIds,
  onSelect
}: ChangeGroupSectionProps) {
  const headerId = useId();
  const pair = group.row === null ? null : result.pagePairs[group.row];
  const ocrLabel = pair
    ? pairOcrLabel({ pair, pageSources: result.pageSources })
    : null;
  return (
    <div role="group" aria-labelledby={headerId}>
      <div
        id={headerId}
        className="text-muted-foreground bg-card-inset border-border flex items-center gap-1 border-b px-4 py-2 text-xs/4 font-medium"
      >
        {pair && <span>{pairPagesLabel(pair)}</span>}
        {ocrLabel && <TextBadge label={ocrLabel} tone={BADGE_TONE.MUTED} />}
        <span>· {group.changes.length}건</span>
      </div>
      <ol className="px-2 py-1">
        {group.changes.map((numbered) => (
          <ChangeListItem
            key={numbered.change.id}
            numbered={numbered}
            isActive={numbered.change.id === activeChangeId}
            isHovered={hoveredChangeIds.includes(numbered.change.id)}
            onSelect={onSelect}
          />
        ))}
      </ol>
    </div>
  );
}

function NoChanges() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="bg-success-subtle text-success-subtle-foreground flex size-10 items-center justify-center rounded-full">
        <Check size={EMPTY_ICON_SIZE} aria-hidden="true" />
      </span>
      <p className="font-semibold">{COMPARE_RESULT_TEXT.NO_CHANGES_TITLE}</p>
      <p className="text-muted-foreground text-xs/4.25">
        {COMPARE_RESULT_TEXT.NO_CHANGES_DESCRIPTION}
      </p>
    </div>
  );
}

interface AllHiddenProps {
  onReset: () => void;
}

function AllHidden({ onReset }: AllHiddenProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-muted-foreground">
        {COMPARE_RESULT_TEXT.ALL_HIDDEN_TITLE}
      </p>
      <Button
        variant="outline"
        onClick={onReset}
        className="bg-card h-8 rounded-md px-3 font-normal"
      >
        {COMPARE_RESULT_TEXT.RESET_FILTER}
      </Button>
    </div>
  );
}

interface ChangeListProps {
  counts: ChangeCounts;
}

/**
 * 왼쪽 차이 목록(시안 4, 340px): 머리(차이 수·쪽별로 묶기·접기), 쪽별 묶음 또는 한 줄 목록.
 * 차이가 없으면 초록 체크, 필터로 모두 숨기면 "필터 초기화". 접으면 좁은 레일만 남는다.
 */
export function ChangeList({ counts }: ChangeListProps) {
  const completed = useCompletedComparison();
  const filter = useChangeFilter();
  const activeChangeId = useActiveChangeId();
  const hoveredChangeIds = useHoveredChangeIds();
  const selectChange = useCompareSessionStore((state) => state.selectChange);
  const resetFilter = useCompareSessionStore((state) => state.resetFilter);
  const [isGrouped, setIsGrouped] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const groupToggleId = useId();

  const result = completed?.result ?? null;
  const groups = useMemo(() => {
    if (!result) return [];
    const visible = numberChanges(result.changes).filter(({ change }) =>
      isChangeVisible({ change, filter })
    );
    return groupByRow({
      changes: visible,
      rows: indexPagePairs(result.pagePairs)
    });
  }, [result, filter]);

  if (!result) return null;

  if (isCollapsed) {
    return (
      <aside
        aria-label={COMPARE_RESULT_TEXT.CHANGE_LIST}
        className="bg-card border-border flex w-11 shrink-0 flex-col items-center gap-2 border-r py-2.5"
      >
        <button
          type="button"
          aria-label={COMPARE_RESULT_TEXT.EXPAND_LIST}
          onClick={() => setIsCollapsed(false)}
          className={PANEL_BUTTON_CLASS}
        >
          <ChevronRight size={PANEL_ICON_SIZE} aria-hidden="true" />
        </button>
        <span className="text-muted-foreground font-mono text-[11px]">
          {counts.visibleDifferences}
        </span>
      </aside>
    );
  }

  const renderContent = () => {
    if (result.changes.length === 0) return <NoChanges />;
    if (groups.length === 0) return <AllHidden onReset={resetFilter} />;
    if (!isGrouped) {
      return (
        <ol className="px-2 py-1">
          {groups
            .flatMap((group) => group.changes)
            .map((numbered) => (
              <ChangeListItem
                key={numbered.change.id}
                numbered={numbered}
                isActive={numbered.change.id === activeChangeId}
                isHovered={hoveredChangeIds.includes(numbered.change.id)}
                onSelect={selectChange}
              />
            ))}
        </ol>
      );
    }
    return groups.map((group) => (
      <ChangeGroupSection
        key={group.key}
        group={group}
        result={result}
        activeChangeId={activeChangeId}
        hoveredChangeIds={hoveredChangeIds}
        onSelect={selectChange}
      />
    ));
  };

  return (
    <aside
      aria-label={COMPARE_RESULT_TEXT.CHANGE_LIST}
      className="bg-card border-border flex w-85 shrink-0 flex-col border-r"
    >
      <div className="border-border flex items-center gap-2 border-b px-4 py-2.5">
        <b className="font-semibold">
          {compareResultMessage.differences(counts.visibleDifferences)}
        </b>
        {counts.totalReview > 0 && (
          <span className="text-muted-foreground text-xs">
            {compareResultMessage.review(counts.visibleReview)}
          </span>
        )}
        <span className="grow" />
        <label
          htmlFor={groupToggleId}
          className="flex cursor-pointer items-center gap-1.5 text-xs"
        >
          <Checkbox
            id={groupToggleId}
            checked={isGrouped}
            onCheckedChange={(checked) => setIsGrouped(checked === true)}
          />
          {COMPARE_RESULT_TEXT.GROUP_BY_PAGE}
        </label>
        <button
          type="button"
          aria-label={COMPARE_RESULT_TEXT.COLLAPSE_LIST}
          onClick={() => setIsCollapsed(true)}
          className={PANEL_BUTTON_CLASS}
        >
          <ChevronLeft size={PANEL_ICON_SIZE} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{renderContent()}</div>
    </aside>
  );
}
