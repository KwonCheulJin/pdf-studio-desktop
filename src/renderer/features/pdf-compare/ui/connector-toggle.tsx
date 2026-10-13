import { useId } from "react";
import { Checkbox } from "@/renderer/shared/ui";
import {
  COMPARE_RESULT_TEXT,
  COMPARE_VIEW_MODE
} from "../config/compare-result";
import {
  useCompareSessionStore,
  useCompareViewMode,
  useIsConnectorShown
} from "../model/compare-session-store";

/**
 * 툴바 "연결선" 체크박스(시안 4). 하이라이트와 별개로 거터의 연결선만 켜고 끈다. 거터가 없는 A만·B만
 * 보기에서는 누를 것이 없어 막는다.
 */
export function ConnectorToggle() {
  const isConnectorShown = useIsConnectorShown();
  const setConnectorShown = useCompareSessionStore(
    (state) => state.setConnectorShown
  );
  const isSideBySide = useCompareViewMode() === COMPARE_VIEW_MODE.SIDE_BY_SIDE;
  const toggleId = useId();

  return (
    <label
      htmlFor={toggleId}
      className="flex cursor-pointer items-center gap-1.5 text-xs has-disabled:cursor-not-allowed has-disabled:opacity-50"
    >
      <Checkbox
        id={toggleId}
        checked={isConnectorShown}
        disabled={!isSideBySide}
        onCheckedChange={(checked) => setConnectorShown(checked === true)}
      />
      {COMPARE_RESULT_TEXT.CONNECTORS}
    </label>
  );
}
