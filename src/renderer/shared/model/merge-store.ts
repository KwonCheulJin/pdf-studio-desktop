import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { PdfDocument, PdfPage, MergeOrderItem } from "./pdf-document";
import {
  MERGE_STATUS,
  MERGE_VIEW,
  type MergeStatus,
  type MergeView
} from "./merge-state";
import { type PageRotation, PAGE_ROTATION } from "../constants/page-state";

interface MergeStoreState {
  files: PdfDocument[];
  mergeOrder: MergeOrderItem[]; // 병합 순서 (페이지 레벨)
  collapsedGroups: Set<string>; // 접힌 그룹 ID 집합
  status: MergeStatus;
  progress: number;
  errorMessage: string | null;
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
  insertFiles: (index: number, documents: PdfDocument[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  reorderFiles: (fromIndex: number, toIndex: number) => void;

  // 병합 순서 액션
  insertFileAtPosition: (params: InsertFileAtPositionParams) => void;
  movePageInMergeOrder: (params: MovePageInMergeOrderParams) => void;

  // 파일 확장/축소
  expandAll: () => void;
  collapseAll: () => void;

  // 그룹 확장/축소 (연속된 같은 파일 페이지 그룹)
  toggleGroupExpand: (groupId: string) => void;
  expandGroup: (groupId: string) => void;

  // 페이지 레벨 액션
  rotatePage: (fileId: string, pageId: string, degrees?: PageRotation) => void;
  deletePage: (fileId: string, pageId: string) => void;
  restorePage: (fileId: string, pageId: string) => void;
  reorderPageWithinFile: (
    fileId: string,
    fromIndex: number,
    toIndex: number
  ) => void;
  movePage: (
    sourceFileId: string,
    pageId: string,
    targetFileId: string,
    targetIndex: number
  ) => void;
  updatePageThumbnail: (
    fileId: string,
    pageId: string,
    thumbnailUrl: string
  ) => void;

  // 상태 액션
  setStatus: (status: MergeStatus) => void;
  setProgress: (progress: number) => void;
  setError: (message: string | null) => void;
  setView: (view: MergeView) => void;
  setMergedDocument: (document: PdfDocument | null) => void;
  reset: () => void;
}

type MergeStore = MergeStoreState & MergeStoreActions;

const initialState: MergeStoreState = {
  files: [],
  mergeOrder: [],
  collapsedGroups: new Set(),
  status: MERGE_STATUS.IDLE,
  progress: 0,
  errorMessage: null,
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

/**
 * PdfDocument 배열에서 mergeOrder 생성
 * 파일 순서대로 각 파일의 활성 페이지들을 나열
 */
function buildMergeOrderFromFiles(files: PdfDocument[]): MergeOrderItem[] {
  return buildMergeOrderItems(files);
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

  insertFiles: (index, documents) =>
    set((state) => {
      const targetFile = state.files[index];
      let insertIndex = state.mergeOrder.length;
      if (targetFile) {
        const firstPageOfTarget = targetFile.pages.find((p) => !p.isDeleted);
        if (firstPageOfTarget) {
          const found = state.mergeOrder.findIndex(
            (item) => item.pageId === firstPageOfTarget.id
          );
          if (found !== -1) insertIndex = found;
        }
      }
      const newMergeOrderItems = buildMergeOrderItems(documents);
      return {
        files: [
          ...state.files.slice(0, index),
          ...documents,
          ...state.files.slice(index)
        ],
        mergeOrder: [
          ...state.mergeOrder.slice(0, insertIndex),
          ...newMergeOrderItems,
          ...state.mergeOrder.slice(insertIndex)
        ]
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
      progress: 0,
      errorMessage: null,
      view: MERGE_VIEW.WORKSPACE,
      mergedDocument: null
    }),

  reorderFiles: (fromIndex, toIndex) =>
    set((state) => {
      const movedFile = state.files[fromIndex];
      const withoutMoved = state.files.filter((_, i) => i !== fromIndex);
      const newFiles = [
        ...withoutMoved.slice(0, toIndex),
        movedFile,
        ...withoutMoved.slice(toIndex)
      ];
      return {
        files: newFiles,
        mergeOrder: buildMergeOrderFromFiles(newFiles)
      };
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

      // 삽입할 아이템들
      const itemsToInsert: MergeOrderItem[] = fileToMove.pages
        .filter((p) => !p.isDeleted)
        .map((p) => ({ fileId, pageId: p.id }));

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

  // 파일 확장/축소
  expandAll: () => set({ collapsedGroups: new Set() }),

  collapseAll: () =>
    set((state) => {
      const allGroupIds = new Set<string>();
      let currentFileId: string | null = null;

      for (const item of state.mergeOrder) {
        if (currentFileId !== item.fileId) {
          currentFileId = item.fileId;
          allGroupIds.add(`group_${item.pageId}`);
        }
      }

      return { collapsedGroups: allGroupIds };
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

  // 페이지 삭제 (soft delete)
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
      ),
      // mergeOrder에서도 해당 페이지 제거
      mergeOrder: state.mergeOrder.filter((item) => item.pageId !== pageId)
    })),

  // 페이지 복원
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

  // 파일 내 페이지 순서 변경
  reorderPageWithinFile: (fileId, fromIndex, toIndex) =>
    set((state) => ({
      files: state.files.map((file) => {
        if (file.id !== fileId) return file;
        const movedPage = file.pages[fromIndex];
        const withoutMoved = file.pages.filter((_, i) => i !== fromIndex);
        const newPages = [
          ...withoutMoved.slice(0, toIndex),
          movedPage,
          ...withoutMoved.slice(toIndex)
        ];
        return { ...file, pages: newPages };
      })
    })),

  // 파일 간 페이지 이동
  movePage: (sourceFileId, pageId, targetFileId, targetIndex) =>
    set((state) => {
      // 같은 파일 내 이동이면 reorderPageWithinFile과 동일
      if (sourceFileId === targetFileId) {
        const file = state.files.find(
          (candidateFile) => candidateFile.id === sourceFileId
        );
        if (!file) return state;
        const fromIndex = file.pages.findIndex((page) => page.id === pageId);
        if (fromIndex === -1) return state;

        return {
          files: state.files.map((mergeFile) => {
            if (mergeFile.id !== sourceFileId) return mergeFile;
            const movedPage = mergeFile.pages[fromIndex];
            const withoutMoved = mergeFile.pages.filter(
              (_, i) => i !== fromIndex
            );
            const newPages = [
              ...withoutMoved.slice(0, targetIndex),
              movedPage,
              ...withoutMoved.slice(targetIndex)
            ];
            return { ...mergeFile, pages: newPages };
          })
        };
      }

      // 다른 파일로 이동
      let movedPage: PdfPage | null = null;

      const filesWithoutPage = state.files.map((file) => {
        if (file.id === sourceFileId) {
          const pageIndex = file.pages.findIndex((page) => page.id === pageId);
          if (pageIndex !== -1) {
            movedPage = file.pages[pageIndex];
            return {
              ...file,
              pages: file.pages.filter((page) => page.id !== pageId)
            };
          }
        }
        return file;
      });

      if (!movedPage) return state;

      const page = movedPage;
      return {
        files: filesWithoutPage.map((file) => {
          if (file.id === targetFileId) {
            const newPages = [
              ...file.pages.slice(0, targetIndex),
              page,
              ...file.pages.slice(targetIndex)
            ];
            return { ...file, pages: newPages };
          }
          return file;
        })
      };
    }),

  // 페이지 썸네일 업데이트
  updatePageThumbnail: (fileId, pageId, thumbnailUrl) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === fileId
          ? {
              ...file,
              pages: file.pages.map((page) =>
                page.id === pageId ? { ...page, thumbnailUrl } : page
              )
            }
          : file
      )
    })),

  setStatus: (status) => set({ status }),

  setProgress: (progress) => set({ progress }),

  setError: (message) =>
    set((state) => ({
      errorMessage: message,
      status: message ? MERGE_STATUS.ERROR : state.status
    })),

  setView: (view) => set({ view }),

  setMergedDocument: (document) => set({ mergedDocument: document }),

  reset: () => set(initialState)
}));

// Selector hooks
export const useMergeFiles = () => useMergeStore((state) => state.files);
export const useMergeOrder = () => useMergeStore((state) => state.mergeOrder);
export const useCollapsedGroups = () =>
  useMergeStore((state) => state.collapsedGroups);
export const useMergeStatus = () => useMergeStore((state) => state.status);
export const useMergeProgress = () => useMergeStore((state) => state.progress);
export const useMergeView = () => useMergeStore((state) => state.view);
export const useMergedDocument = () =>
  useMergeStore((state) => state.mergedDocument);

// 전체 페이지 수 (삭제된 것 포함)
export const useTotalPages = () =>
  useMergeStore((state) =>
    state.files.reduce((sum, file) => sum + file.pageCount, 0)
  );

// 활성 페이지 수 (삭제되지 않은 것만)
export const useTotalActivePages = () =>
  useMergeStore((state) =>
    state.files.reduce(
      (sum, file) => sum + file.pages.filter((page) => !page.isDeleted).length,
      0
    )
  );

// 특정 파일의 활성 페이지만 반환
export const useActivePages = (fileId: string) =>
  useMergeStore(
    useShallow((state) => {
      const file = state.files.find((candidate) => candidate.id === fileId);
      return file?.pages.filter((page) => !page.isDeleted) ?? [];
    })
  );

// 특정 파일 찾기
export const useFile = (fileId: string) =>
  useMergeStore((state) =>
    state.files.find((candidate) => candidate.id === fileId)
  );
