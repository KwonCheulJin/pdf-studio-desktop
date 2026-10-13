import { create } from "zustand";

interface ChangeHoverState {
  /** 연결선에 마우스를 올린 변경. 페이지 상자와 목록 항목을 함께 강조한다(계획서 §7.1). */
  hoveredChangeId: string | null;
  setHoveredChangeId: (hoveredChangeId: string | null) => void;
}

/** 결과 화면에서 지금 마우스가 가리키는 연결선의 변경. 화면 사이에 남길 필요가 없는 순간 상태다. */
export const useChangeHoverStore = create<ChangeHoverState>((set) => ({
  hoveredChangeId: null,
  setHoveredChangeId: (hoveredChangeId) => set({ hoveredChangeId })
}));

export const useHoveredChangeId = () =>
  useChangeHoverStore((state) => state.hoveredChangeId);
