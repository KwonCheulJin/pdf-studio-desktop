import { useMemo } from "react";
import {
  connectorOf,
  isChangeVisible,
  type Connector
} from "@/renderer/entities/comparison";
import { COMPARE_VIEW_MODE } from "../config/compare-result";
import {
  useChangeFilter,
  useCompareViewMode,
  useCompletedComparison,
  useIsConnectorShown
} from "./compare-session-store";

/**
 * 그릴 연결선(계획서 §7.1): 변경마다 하나, 결과 순서. 나란히 보기에서 "연결선"을 켰을 때만 만들고,
 * 아니면 `null`이다. 필터로 숨긴 변경과 끝의 쪽이 문서에 없는 변경(쪽이 0개인 문서의 앵커)은 뺀다.
 * 끝은 사용자 공간이라 배율과 상관없다.
 */
export function useConnectors(): readonly Connector[] | null {
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
    return result.changes.flatMap((change) => {
      if (!isChangeVisible({ change, filter })) return [];
      const connector = connectorOf({ change, pageSizes: result.pageSizes });
      return connector ? [connector] : [];
    });
  }, [result, filter, viewMode, isConnectorShown]);
}
