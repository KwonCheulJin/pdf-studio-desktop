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
  ensurePagesSelected: (pageIds: string[]) => void;
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
      const isFileSelected = state.selectedIds.has(fileId);
      const excludeIds = new Set([fileId, ...pageIds]);

      const newSelectedIds = isFileSelected
        ? new Set([...state.selectedIds].filter((id) => !excludeIds.has(id)))
        : new Set([...state.selectedIds, fileId, ...pageIds]);

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
      const ids = new Set(Array.isArray(idOrIds) ? idOrIds : [idOrIds]);
      const newSelectedIds = new Set(
        [...state.selectedIds].filter((id) => !ids.has(id))
      );
      return {
        selectedIds: newSelectedIds,
        lastSelectedId: ids.has(state.lastSelectedId ?? "")
          ? null
          : state.lastSelectedId
      };
    }),

  ensurePagesSelected: (pageIds: string[]) =>
    set((state) => ({
      selectedIds: new Set([...state.selectedIds, ...pageIds])
    }))
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
