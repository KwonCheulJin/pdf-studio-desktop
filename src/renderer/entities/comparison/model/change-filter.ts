import type { Change, ChangeKind } from "@/renderer/shared/api/bindings";
import { CHANGE_KIND } from "../config/change-kind";

/** 결과 화면의 칩 필터. 숨긴 것만 담는다(기본은 모두 보임). */
export interface ChangeFilter {
  hiddenKinds: readonly ChangeKind[];
  /** "확인 필요" 칩을 껐는가 */
  isReviewHidden: boolean;
}

export const EMPTY_CHANGE_FILTER: ChangeFilter = {
  hiddenKinds: [],
  isReviewHidden: false
};

interface IsChangeVisibleParams {
  change: Change;
  filter: ChangeFilter;
}

/** 종류 필터는 차이와 확인 필요에 똑같이 적용하고, 확인 필요 칩은 확인 필요만 숨긴다(ADR 0001 §5). */
export function isChangeVisible({
  change,
  filter
}: IsChangeVisibleParams): boolean {
  if (filter.hiddenKinds.includes(change.kind)) return false;
  return !(change.needsReview && filter.isReviewHidden);
}

export interface ChangeCounts {
  /** 종류 칩 개수: 그 종류의 차이(확인 필요 제외). 필터와 상관없다. */
  differencesByKind: Record<ChangeKind, number>;
  /** 확인 필요 칩 개수: 숨기지 않은 종류의 확인 필요 */
  reviewInShownKinds: number;
  /** 지금 보이는 차이·확인 필요 */
  visibleDifferences: number;
  visibleReview: number;
  /** 필터로 숨긴 변경 */
  hidden: number;
  /** 필터와 상관없는 전체 차이·확인 필요(상태바) */
  totalDifferences: number;
  totalReview: number;
}

interface CountChangesParams {
  changes: readonly Change[];
  filter: ChangeFilter;
}

const NO_CHANGES_BY_KIND: Record<ChangeKind, number> = {
  [CHANGE_KIND.INSERT]: 0,
  [CHANGE_KIND.DELETE]: 0,
  [CHANGE_KIND.REPLACE]: 0
};

/**
 * 결과 화면의 개수. 차이 = `needs_review == false`, 확인 필요 = `true`로 나누고 한 변경을 두 곳에
 * 세지 않는다(ADR 0001 §5).
 */
export function countChanges({
  changes,
  filter
}: CountChangesParams): ChangeCounts {
  const differences = changes.filter((change) => !change.needsReview);
  const review = changes.filter((change) => change.needsReview);
  const isKindShown = (change: Change) =>
    !filter.hiddenKinds.includes(change.kind);
  const visibleDifferences = differences.filter(isKindShown).length;
  const reviewInShownKinds = review.filter(isKindShown).length;
  const visibleReview = filter.isReviewHidden ? 0 : reviewInShownKinds;
  return {
    differencesByKind: differences.reduce(
      (counts, change) => ({
        ...counts,
        [change.kind]: counts[change.kind] + 1
      }),
      NO_CHANGES_BY_KIND
    ),
    reviewInShownKinds,
    visibleDifferences,
    visibleReview,
    hidden: changes.length - visibleDifferences - visibleReview,
    totalDifferences: differences.length,
    totalReview: review.length
  };
}

/** 이전/다음 이동과 위치 표시("3 / 25") */
export interface ChangePosition {
  /** 보이는 변경 중 고른 변경의 순번(1부터). 고르지 않았거나 숨겨졌으면 `null` */
  position: number | null;
  /** 보이는 변경 수 */
  total: number;
  previousId: string | null;
  nextId: string | null;
}

interface ChangePositionParams {
  changes: readonly Change[];
  filter: ChangeFilter;
  activeChangeId: string | null;
}

/**
 * 보이는 변경을 결과 순서(diff 순서 = 목록 순서)로 훑는다. 고른 변경이 숨겨져 있어도 그 자리의
 * 앞뒤로 움직이고, 고른 것이 없으면 다음은 처음, 이전은 마지막이다.
 */
export function changePositionOf({
  changes,
  filter,
  activeChangeId
}: ChangePositionParams): ChangePosition {
  const activeIndex = changes.findIndex(({ id }) => id === activeChangeId);
  const visible = changes.flatMap((change, index) =>
    isChangeVisible({ change, filter }) ? [{ id: change.id, index }] : []
  );
  const visiblePosition = visible.findIndex(({ id }) => id === activeChangeId);
  const hasActive = activeIndex >= 0;
  const next = visible.find(({ index }) => !hasActive || index > activeIndex);
  const previous = [...visible]
    .reverse()
    .find(({ index }) => !hasActive || index < activeIndex);
  return {
    position: visiblePosition >= 0 ? visiblePosition + 1 : null,
    total: visible.length,
    previousId: previous?.id ?? null,
    nextId: next?.id ?? null
  };
}
