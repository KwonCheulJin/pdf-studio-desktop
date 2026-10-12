import { create } from "zustand";
import { SELECTION_TYPE, type SelectionType } from "../config/selection-type";

interface SelectionStoreState {
  selectionType: SelectionType; // 현재 선택 모드 (파일 vs 페이지)
  selectedIds: Set<string>; // 파일 ID 또는 페이지 ID
  lastSelectedId: string | null; // 범위 선택(Shift) 기준점
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
  switchToPageMode: (fileIds: string[], togglePageId: string) => void;
}

type SelectionStore = SelectionStoreState & SelectionStoreActions;

const initialState: SelectionStoreState = {
  selectionType: SELECTION_TYPE.FILE,
  selectedIds: new Set(),
  lastSelectedId: null
};

export const useSelectionStore = create<SelectionStore>((set) => ({
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

  // 파일 목록 관례: 기준점(마지막 단일·토글 선택)부터 대상까지로 선택을 바꾸고 기준점은 그대로 둔다.
  selectRange: (allIds: string[], targetId: string) =>
    set((state) => {
      const { lastSelectedId } = state;
      if (!lastSelectedId) {
        return {
          selectedIds: new Set([targetId]),
          lastSelectedId: targetId
        };
      }

      const anchorIndex = allIds.indexOf(lastSelectedId);
      const targetIndex = allIds.indexOf(targetId);

      if (anchorIndex === -1 || targetIndex === -1) {
        return {
          selectedIds: new Set([targetId]),
          lastSelectedId: targetId
        };
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);

      return { selectedIds: new Set(allIds.slice(start, end + 1)) };
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
        lastSelectedId:
          state.lastSelectedId !== null && ids.has(state.lastSelectedId)
            ? null
            : state.lastSelectedId
      };
    }),

  ensurePagesSelected: (pageIds: string[]) =>
    set((state) => ({
      selectedIds: new Set([...state.selectedIds, ...pageIds])
    })),

  switchToPageMode: (fileIds: string[], togglePageId: string) =>
    set((state) => {
      const fileIdSet = new Set(fileIds);
      const pageOnlyIds = new Set(
        [...state.selectedIds].filter((id) => !fileIdSet.has(id))
      );
      if (pageOnlyIds.has(togglePageId)) {
        pageOnlyIds.delete(togglePageId);
      } else {
        pageOnlyIds.add(togglePageId);
      }
      return {
        selectionType: SELECTION_TYPE.PAGE,
        selectedIds: pageOnlyIds,
        lastSelectedId: togglePageId
      };
    })
}));

// Selector hooks
export const useSelectionType = () =>
  useSelectionStore((state) => state.selectionType);

export const useSelectedIds = () =>
  useSelectionStore((state) => state.selectedIds);

export const useIsSelected = (id: string) =>
  useSelectionStore((state) => state.selectedIds.has(id));
