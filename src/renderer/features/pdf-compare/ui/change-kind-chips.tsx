import {
  CHANGE_KIND_LABEL,
  CHANGE_KINDS,
  ChangeSwatch,
  COMPARISON_TEXT,
  type ChangeCounts,
  type ChangeKind
} from "@/renderer/entities/comparison";
import { cn } from "@/renderer/shared/lib/utils";
import {
  COMPARE_RESULT_TEXT,
  compareResultMessage
} from "../config/compare-result";
import {
  useChangeFilter,
  useCompareSessionStore
} from "../model/compare-session-store";

interface FilterChipProps {
  label: string;
  count: number;
  isShown: boolean;
  kind: ChangeKind | null;
  onToggle: () => void;
}

/** 칩 하나(시안 4: 높이 28px, 둥근 끝, 12px 500). 끈 칩은 회색 + 취소선 */
function FilterChip({
  label,
  count,
  isShown,
  kind,
  onToggle
}: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={isShown}
      onClick={onToggle}
      className={cn(
        "border-border focus-visible:ring-ring flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
        isShown
          ? "bg-card text-foreground hover:bg-accent"
          : "bg-muted text-muted-foreground line-through"
      )}
    >
      <ChangeSwatch kind={kind} className={cn(!isShown && "opacity-40")} />
      {compareResultMessage.chip({ label, count })}
    </button>
  );
}

interface ChangeKindChipsProps {
  counts: ChangeCounts;
}

/**
 * 종류 칩(추가·삭제·변경, 차이 개수) + "확인 필요" 칩(차이 개수에 넣지 않고 따로 센다, ADR 0001 §5)
 * + 필터로 숨긴 수. 칩을 누르면 그 종류를 숨기거나 다시 보인다.
 */
export function ChangeKindChips({ counts }: ChangeKindChipsProps) {
  const filter = useChangeFilter();
  const toggleKindHidden = useCompareSessionStore(
    (state) => state.toggleKindHidden
  );
  const toggleReviewHidden = useCompareSessionStore(
    (state) => state.toggleReviewHidden
  );

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <div
        role="group"
        aria-label={COMPARE_RESULT_TEXT.KIND_FILTER}
        className="flex gap-1.5"
      >
        {CHANGE_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            kind={kind}
            label={CHANGE_KIND_LABEL[kind]}
            count={counts.differencesByKind[kind]}
            isShown={!filter.hiddenKinds.includes(kind)}
            onToggle={() => toggleKindHidden(kind)}
          />
        ))}
        {counts.totalReview > 0 && (
          <FilterChip
            kind={null}
            label={COMPARISON_TEXT.NEEDS_REVIEW}
            count={counts.reviewInShownKinds}
            isShown={!filter.isReviewHidden}
            onToggle={toggleReviewHidden}
          />
        )}
      </div>
      {counts.hidden > 0 && (
        <span className="text-muted-foreground ml-1.5 text-xs">
          {compareResultMessage.hidden(counts.hidden)}
        </span>
      )}
    </div>
  );
}
