import { useMemo } from "react";
import {
  isChangeVisible,
  rowConnectorStems,
  type ConnectorStem
} from "@/renderer/entities/comparison";
import { COMPARE_VIEW_MODE } from "../config/compare-result";
import {
  useChangeFilter,
  useCompareViewMode,
  useCompletedComparison,
  useIsConnectorShown
} from "./compare-session-store";

/**
 * 결과 행(`page_pairs` 순서)마다 그릴 연결선 묶음(계획서 §7.1). 나란히 보기에서 "연결선"을 켰을 때만
 * 만들고, 아니면 `null`이다. 필터로 숨긴 변경은 입력에서 뺀다. 묶음은 pt로 계산해 배율과 상관없다.
 */
export function useConnectorStems():
  | readonly (readonly ConnectorStem[])[]
  | null {
  const completed = useCompletedComparison();
  const filter = useChangeFilter();
  const viewMode = useCompareViewMode();
  const isConnectorShown = useIsConnectorShown();
  const result = completed?.result ?? null;

  return useMemo(() => {
    if (
      !result ||
      !isConnectorShown ||
      viewMode !== COMPARE_VIEW_MODE.SIDE_BY_SIDE
    ) {
      return null;
    }
    const visible = result.changes.filter((change) =>
      isChangeVisible({ change, filter })
    );
    return result.pagePairs.map((pair) =>
      rowConnectorStems({
        changes: visible,
        pair,
        pageSizes: result.pageSizes
      })
    );
  }, [result, filter, viewMode, isConnectorShown]);
}
