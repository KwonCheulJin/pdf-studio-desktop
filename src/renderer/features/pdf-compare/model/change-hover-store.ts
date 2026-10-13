import { create } from "zustand";

interface ChangeHoverState {
  /** 연결선에 마우스를 올린 묶음의 변경. 페이지 상자와 목록 항목을 함께 강조한다(계획서 §7.1). */
  hoveredChangeIds: readonly string[];
  setHoveredChangeIds: (hoveredChangeIds: readonly string[]) => void;
}

const NO_HOVER: readonly string[] = [];

/** 결과 화면에서 지금 마우스가 가리키는 연결선 묶음. 화면 사이에 남길 필요가 없는 순간 상태다. */
export const useChangeHoverStore = create<ChangeHoverState>((set) => ({
  hoveredChangeIds: NO_HOVER,
  setHoveredChangeIds: (hoveredChangeIds) =>
    set({
      hoveredChangeIds:
        hoveredChangeIds.length > 0 ? hoveredChangeIds : NO_HOVER
    })
}));

export const useHoveredChangeIds = () =>
  useChangeHoverStore((state) => state.hoveredChangeIds);
