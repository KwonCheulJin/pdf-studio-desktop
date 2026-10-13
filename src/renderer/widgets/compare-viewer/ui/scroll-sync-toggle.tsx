import { useId } from "react";
import {
  COMPARE_VIEW_MODE,
  useCompareViewMode
} from "@/renderer/features/pdf-compare";
import { Checkbox } from "@/renderer/shared/ui";
import { VIEWER_TEXT } from "../config/viewer-layout";
import { useIsScrollSynced, useViewerStore } from "../model/viewer-store";

/**
 * 툴바 "동기 스크롤" 체크박스(계획서 §7.1, 기본 켬). 켜면 A·B 패널이 함께 스크롤하고, 끄면 따로 스크롤해
 * 연결선 기울기로 위치 차이를 보인다. 패널이 하나인 A만·B만 보기에서는 막는다.
 */
export function ScrollSyncToggle() {
  const isScrollSynced = useIsScrollSynced();
  const setScrollSynced = useViewerStore((state) => state.setScrollSynced);
  const isSideBySide = useCompareViewMode() === COMPARE_VIEW_MODE.SIDE_BY_SIDE;
  const toggleId = useId();

  return (
    <label
      htmlFor={toggleId}
      className="flex cursor-pointer items-center gap-1.5 text-xs has-disabled:cursor-not-allowed has-disabled:opacity-50"
    >
      <Checkbox
        id={toggleId}
        checked={isScrollSynced}
        disabled={!isSideBySide}
        onCheckedChange={(checked) => setScrollSynced(checked === true)}
      />
      {VIEWER_TEXT.SCROLL_SYNC}
    </label>
  );
}
