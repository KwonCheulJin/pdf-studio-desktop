import {
  COMPARE_SIDE,
  displayPageNumber,
  pageOfPair
} from "@/renderer/entities/comparison";
import {
  COMPARE_VIEW_MODE,
  useCompareViewMode,
  useCompletedComparison
} from "@/renderer/features/pdf-compare";
import { VIEWER_TEXT } from "../config/viewer-layout";
import { useCurrentRow } from "../model/viewer-store";

/** 현재 쪽이 그 문서에 없을 때(짝 없는 행) */
const NO_PAGE_TEXT = "–";

/**
 * 툴바의 현재 쪽 "3 / 19쪽"(시안 4). 페이지 영역 세로 가운데 행의 쪽이고, A만 보기는 A 문서,
 * 나란히·B만은 B 문서(바뀐 뒤 문서) 기준이다.
 */
export function CurrentPageIndicator() {
  const completed = useCompletedComparison();
  const viewMode = useCompareViewMode();
  const currentRow = useCurrentRow(completed?.jobId ?? "");
  if (!completed) return null;
  const side =
    viewMode === COMPARE_VIEW_MODE.BEFORE_ONLY
      ? COMPARE_SIDE.BEFORE
      : COMPARE_SIDE.AFTER;
  const pair = completed.result.pagePairs[currentRow];
  const page = pair ? pageOfPair({ pair, side }) : null;
  return (
    <span
      role="status"
      aria-label={VIEWER_TEXT.CURRENT_PAGE}
      className="text-muted-foreground font-mono text-xs"
    >
      {page === null ? NO_PAGE_TEXT : displayPageNumber(page)} /{" "}
      {completed.files[side].pageCount}쪽
    </span>
  );
}
