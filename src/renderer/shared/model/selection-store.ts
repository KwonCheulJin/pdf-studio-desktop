import { create } from "zustand";
import { SELECTION_TYPE, type SelectionType } from "../constants/page-state";

interface SelectionStoreState {
  selectionType: SelectionType; // 현재 선택 모드 (파일 vs 페이지)
  selectedIds: Set<string>; // 파일 ID 또는 페이지 ID
  lastSelectedId: string | null;
}

interface SelectionStoreActions {
  setSelectionType: (type: SelectionType) => void;
  select: (id: string) => void;
  toggle: (id: string) => void;
  toggleFileWithPages: (fileId: string, pageIds: string[]) => void;
  selectRange: (allIds: string[], targetId: string) => void;
  clearSelection: () => void;
  selectAll: (ids: string[]) => void;
  removeFromSelection: (idOrIds: string | string[]) => void;
}

type SelectionStore = SelectionStoreState & SelectionStoreActions;

const initialState: SelectionStoreState = {
  selectionType: SELECTION_TYPE.FILE,
  selectedIds: new Set(),
  lastSelectedId: null
};

export const useSelectionStore = create<SelectionStore>((set, get) => ({
  ...initialState,

  setSelectionType: (type: SelectionType) =>
    set({
      selectionType: type,
      selectedIds: new Set(),
      lastSelectedId: null
    }),

  select: (id: string) =>
    set({
      selectedIds: new Set([id]),
      lastSelectedId: id
    }),

  toggle: (id: string) =>
    set((state) => {
      const newSelectedIds = new Set(state.selectedIds);
      if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
      } else {
        newSelectedIds.add(id);
      }
      return {
        selectedIds: newSelectedIds,
        lastSelectedId: id
      };
    }),

  toggleFileWithPages: (fileId: string, pageIds: string[]) =>
    set((state) => {
      const newSelectedIds = new Set(state.selectedIds);
      const isFileSelected = newSelectedIds.has(fileId);

      if (isFileSelected) {
        // 파일 선택 해제 시 해당 파일의 모든 페이지도 해제
        newSelectedIds.delete(fileId);
        pageIds.forEach((id) => newSelectedIds.delete(id));
      } else {
        // 파일 선택 시 해당 파일의 모든 페이지도 선택
        newSelectedIds.add(fileId);
        pageIds.forEach((id) => newSelectedIds.add(id));
      }

      return {
        selectedIds: newSelectedIds,
        lastSelectedId: fileId
      };
    }),

  selectRange: (allIds: string[], targetId: string) =>
    set((state) => {
      const { lastSelectedId } = state;
      if (!lastSelectedId) {
        return {
          selectedIds: new Set([targetId]),
          lastSelectedId: targetId
        };
      }

      const lastIndex = allIds.indexOf(lastSelectedId);
      const targetIndex = allIds.indexOf(targetId);

      if (lastIndex === -1 || targetIndex === -1) {
        return {
          selectedIds: new Set([targetId]),
          lastSelectedId: targetId
        };
      }

      const start = Math.min(lastIndex, targetIndex);
      const end = Math.max(lastIndex, targetIndex);
      const rangeIds = allIds.slice(start, end + 1);

      return {
        selectedIds: new Set([...state.selectedIds, ...rangeIds]),
        lastSelectedId: targetId
      };
    }),

  clearSelection: () =>
    set({
      selectedIds: new Set(),
      lastSelectedId: null
    }),

  selectAll: (ids: string[]) =>
    set({
      selectedIds: new Set(ids),
      lastSelectedId: ids.length > 0 ? ids[ids.length - 1] : null
    }),

  removeFromSelection: (idOrIds: string | string[]) =>
    set((state) => {
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
      const newSelectedIds = new Set(state.selectedIds);
      ids.forEach((id) => newSelectedIds.delete(id));
      return {
        selectedIds: newSelectedIds,
        lastSelectedId: ids.includes(state.lastSelectedId ?? "")
          ? null
          : state.lastSelectedId
      };
    })
}));

// Selector hooks
export const useSelectionType = () =>
  useSelectionStore((state) => state.selectionType);

export const useSelectedIds = () =>
  useSelectionStore((state) => state.selectedIds);

export const useSelectedCount = () =>
  useSelectionStore((state) => state.selectedIds.size);

export const useIsSelected = (id: string) =>
  useSelectionStore((state) => state.selectedIds.has(id));
