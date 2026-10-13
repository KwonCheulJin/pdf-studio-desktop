import { create } from "zustand";
import type { PdfDocument, MergeOrderItem } from "./pdf-document";
import {
  MERGE_STATUS,
  MERGE_VIEW,
  type MergeStatus,
  type MergeView
} from "./merge-state";
import { type PageRotation, PAGE_ROTATION } from "../config/page-rotation";

interface MergeStoreState {
  files: PdfDocument[];
  mergeOrder: MergeOrderItem[]; // 병합 순서 (페이지 레벨)
  collapsedGroups: Set<string>; // 접힌 그룹 ID 집합
  status: MergeStatus;
  view: MergeView;
  mergedDocument: PdfDocument | null;
}

/**
 * 파일을 특정 위치에 삽입하기 위한 파라미터
 */
interface InsertFileAtPositionParams {
  fileId: string; // 이동할 파일의 ID
  targetPageId: string | null; // 삽입 위치 (이 페이지 앞에 삽입, null이면 끝에 삽입)
}

/**
 * mergeOrder 내에서 단일 페이지를 이동하기 위한 파라미터
 */
interface MovePageInMergeOrderParams {
  pageId: string; // 이동할 페이지 ID
  targetPageId: string | null; // 삽입 위치 (이 페이지 앞에 삽입, null이면 끝에 삽입)
}

interface MergeStoreActions {
  // 파일 레벨 액션
  addFiles: (documents: PdfDocument[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;

  // 병합 순서 액션
  insertFileAtPosition: (params: InsertFileAtPositionParams) => void;
  movePageInMergeOrder: (params: MovePageInMergeOrderParams) => void;

  // 그룹 확장/축소 (연속된 같은 파일 페이지 그룹)
  toggleGroupExpand: (groupId: string) => void;
  expandGroup: (groupId: string) => void;

  // 페이지 레벨 액션
  rotatePage: (fileId: string, pageId: string, degrees?: PageRotation) => void;
  deletePage: (fileId: string, pageId: string) => void;
  restorePage: (fileId: string, pageId: string) => void;

  // 상태 액션
  setStatus: (status: MergeStatus) => void;
  setView: (view: MergeView) => void;
  setMergedDocument: (document: PdfDocument | null) => void;
}

type MergeStore = MergeStoreState & MergeStoreActions;

const initialState: MergeStoreState = {
  files: [],
  mergeOrder: [],
  collapsedGroups: new Set(),
  status: MERGE_STATUS.IDLE,
  view: MERGE_VIEW.WORKSPACE,
  mergedDocument: null
};

/**
 * PdfDocument 배열에서 mergeOrder 아이템 생성
 */
function buildMergeOrderItems(docs: PdfDocument[]): MergeOrderItem[] {
  return docs.flatMap((doc) =>
    doc.pages
      .filter((page) => !page.isDeleted)
      .map((page) => ({ fileId: doc.id, pageId: page.id }))
  );
}

export const useMergeStore = create<MergeStore>((set) => ({
  ...initialState,

  addFiles: (documents) =>
    set((state) => {
      const newGroupIds = documents
        .map((doc) => {
          const firstPage = doc.pages.find((p) => !p.isDeleted);
          return firstPage ? `group_${firstPage.id}` : null;
        })
        .filter((id): id is string => id !== null);

      return {
        files: [...state.files, ...documents],
        mergeOrder: [...state.mergeOrder, ...buildMergeOrderItems(documents)],
        collapsedGroups: new Set([...state.collapsedGroups, ...newGroupIds])
      };
    }),

  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((file) => file.id !== id),
      mergeOrder: state.mergeOrder.filter((item) => item.fileId !== id)
    })),

  clearFiles: () =>
    set({
      files: [],
      mergeOrder: [],
      collapsedGroups: new Set(),
      status: MERGE_STATUS.IDLE,
      view: MERGE_VIEW.WORKSPACE,
      mergedDocument: null
    }),

  // 파일을 특정 페이지 위치에 삽입 (페이지 레벨 순서 관리)
  insertFileAtPosition: ({ fileId, targetPageId }) =>
    set((state) => {
      // 이동할 파일 찾기
      const fileToMove = state.files.find((f) => f.id === fileId);
      if (!fileToMove) return state;

      // mergeOrder에서 이동할 파일의 페이지들 제거
      const orderWithoutMovingFile = state.mergeOrder.filter(
        (item) => item.fileId !== fileId
      );

      // 삽입할 아이템들. 삭제된 페이지도 함께 옮겨야 제자리에서 복원할 수 있다.
      const itemsToInsert: MergeOrderItem[] = fileToMove.pages.map((p) => ({
        fileId,
        pageId: p.id
      }));

      // 삽입 위치 결정
      let insertIndex: number;
      if (targetPageId === null) {
        // 끝에 삽입
        insertIndex = orderWithoutMovingFile.length;
      } else {
        // targetPageId 앞에 삽입
        insertIndex = orderWithoutMovingFile.findIndex(
          (item) => item.pageId === targetPageId
        );
        if (insertIndex === -1) {
          insertIndex = orderWithoutMovingFile.length;
        }
      }

      // 같은 위치에 드롭한 경우 (이동 없음)
      // 현재 위치와 목표 위치가 같은지 확인
      const currentFirstIndex = state.mergeOrder.findIndex(
        (item) => item.fileId === fileId
      );
      if (currentFirstIndex !== -1) {
        const targetIndex =
          targetPageId === null
            ? state.mergeOrder.length
            : state.mergeOrder.findIndex(
                (item) => item.pageId === targetPageId
              );

        // 이동할 파일이 이미 targetPageId 바로 앞에 있으면 변경 없음
        if (targetIndex === currentFirstIndex) {
          return state;
        }
      }

      // 새 mergeOrder 생성
      return {
        mergeOrder: [
          ...orderWithoutMovingFile.slice(0, insertIndex),
          ...itemsToInsert,
          ...orderWithoutMovingFile.slice(insertIndex)
        ]
      };
    }),

  // mergeOrder 내 단일 페이지 이동
  movePageInMergeOrder: ({ pageId, targetPageId }) =>
    set((state) => {
      // 현재 위치 확인
      const currentIndex = state.mergeOrder.findIndex(
        (item) => item.pageId === pageId
      );
      if (currentIndex === -1) return state;

      // 자기 자신 앞에 드롭한 경우 무시
      if (targetPageId === pageId) {
        return state;
      }

      // 이동 대상 아이템 분리
      const movingItem = state.mergeOrder[currentIndex];
      const orderWithoutPage = state.mergeOrder.filter(
        (item) => item.pageId !== pageId
      );

      // 삽입 위치 계산
      let insertIndex: number;
      if (targetPageId === null) {
        insertIndex = orderWithoutPage.length;
      } else {
        insertIndex = orderWithoutPage.findIndex(
          (item) => item.pageId === targetPageId
        );
        if (insertIndex === -1) {
          insertIndex = orderWithoutPage.length;
        }
      }

      // 이동 결과가 동일한 순서라면 스킵
      if (currentIndex === insertIndex) {
        return state;
      }

      return {
        mergeOrder: [
          ...orderWithoutPage.slice(0, insertIndex),
          movingItem,
          ...orderWithoutPage.slice(insertIndex)
        ]
      };
    }),

  // 그룹 확장/축소 토글
  toggleGroupExpand: (groupId) =>
    set((state) => ({
      collapsedGroups: state.collapsedGroups.has(groupId)
        ? new Set([...state.collapsedGroups].filter((id) => id !== groupId))
        : new Set([...state.collapsedGroups, groupId])
    })),

  // 그룹 명시적 펼침 (collapsedGroups에서 제거)
  expandGroup: (groupId) =>
    set((state) => {
      if (!state.collapsedGroups.has(groupId)) return state;
      return {
        collapsedGroups: new Set(
          [...state.collapsedGroups].filter((id) => id !== groupId)
        )
      };
    }),

  // 페이지 회전 (기본: 90도 시계 방향, 또는 지정된 각도 추가)
  rotatePage: (fileId, pageId, degrees = PAGE_ROTATION.DEG_90) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === fileId
          ? {
              ...file,
              pages: file.pages.map((page) =>
                page.id === pageId
                  ? {
                      ...page,
                      rotation: ((page.rotation + degrees) %
                        360) as PageRotation
                    }
                  : page
              )
            }
          : file
      )
    })),

  // 페이지 삭제 (soft delete). mergeOrder에는 남겨 두어 제자리에서 복원할 수 있게 한다.
  deletePage: (fileId, pageId) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === fileId
          ? {
              ...file,
              pages: file.pages.map((page) =>
                page.id === pageId ? { ...page, isDeleted: true } : page
              )
            }
          : file
      )
    })),

  // 페이지 복원. mergeOrder 자리가 그대로라 원래 위치로 돌아간다.
  restorePage: (fileId, pageId) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === fileId
          ? {
              ...file,
              pages: file.pages.map((page) =>
                page.id === pageId ? { ...page, isDeleted: false } : page
              )
            }
          : file
      )
    })),

  setStatus: (status) => set({ status }),

  setView: (view) => set({ view }),

  setMergedDocument: (document) => set({ mergedDocument: document })
}));

// Selector hooks
export const useMergeFiles = () => useMergeStore((state) => state.files);
export const useMergeOrder = () => useMergeStore((state) => state.mergeOrder);
export const useCollapsedGroups = () =>
  useMergeStore((state) => state.collapsedGroups);
export const useMergeStatus = () => useMergeStore((state) => state.status);
export const useMergeView = () => useMergeStore((state) => state.view);
export const useMergedDocument = () =>
  useMergeStore((state) => state.mergedDocument);

// 활성 페이지 수 (삭제되지 않은 것만)
export const useTotalActivePages = () =>
  useMergeStore((state) =>
    state.files.reduce(
      (sum, file) => sum + file.pages.filter((page) => !page.isDeleted).length,
      0
    )
  );

// 삭제 표시된(복원할 수 있는) 페이지 수
export const useTotalDeletedPages = () =>
  useMergeStore((state) =>
    state.files.reduce(
      (sum, file) => sum + file.pages.filter((page) => page.isDeleted).length,
      0
    )
  );

// 특정 파일 찾기
export const useFile = (fileId: string) =>
  useMergeStore((state) =>
    state.files.find((candidate) => candidate.id === fileId)
  );
