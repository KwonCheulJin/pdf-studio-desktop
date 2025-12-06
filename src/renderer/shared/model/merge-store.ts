import { create } from "zustand";
import type { PdfDocument, PdfPage, MergeOrderItem } from "./pdf-document";
import { MERGE_STATUS, type MergeStatus } from "./merge-state";
import { type PageRotation, PAGE_ROTATION } from "../constants/page-state";

interface MergeStoreState {
  files: PdfDocument[];
  mergeOrder: MergeOrderItem[]; // 병합 순서 (페이지 레벨)
  status: MergeStatus;
  progress: number;
  errorMessage: string | null;
}

/**
 * 파일을 특정 위치에 삽입하기 위한 파라미터
 */
interface InsertFileAtPositionParams {
  fileId: string; // 이동할 파일의 ID
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

  // 파일 확장/축소
  toggleExpand: (fileId: string) => void;
  expandAll: () => void;
  collapseAll: () => void;

  // 페이지 레벨 액션
  rotatePage: (fileId: string, pageId: string, degrees?: number) => void;
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
  reset: () => void;
}

type MergeStore = MergeStoreState & MergeStoreActions;

const initialState: MergeStoreState = {
  files: [],
  mergeOrder: [],
  status: MERGE_STATUS.IDLE,
  progress: 0,
  errorMessage: null
};

/**
 * PdfDocument 배열에서 mergeOrder 생성
 * 파일 순서대로 각 파일의 활성 페이지들을 나열
 */
function buildMergeOrderFromFiles(files: PdfDocument[]): MergeOrderItem[] {
  return files.flatMap((file) =>
    file.pages
      .filter((page) => !page.isDeleted)
      .map((page) => ({
        fileId: file.id,
        pageId: page.id
      }))
  );
}

export const useMergeStore = create<MergeStore>((set) => ({
  ...initialState,

  addFiles: (documents) =>
    set((state) => {
      const newFiles = [...state.files, ...documents];
      // 새 파일들의 페이지를 mergeOrder 끝에 추가
      const newMergeOrderItems = documents.flatMap((doc) =>
        doc.pages
          .filter((page) => !page.isDeleted)
          .map((page) => ({
            fileId: doc.id,
            pageId: page.id
          }))
      );
      return {
        files: newFiles,
        mergeOrder: [...state.mergeOrder, ...newMergeOrderItems]
      };
    }),

  insertFiles: (index, documents) =>
    set((state) => {
      const newFiles = [...state.files];
      newFiles.splice(index, 0, ...documents);
      // 삽입 위치에 해당하는 mergeOrder 인덱스 찾기
      // index 번째 파일의 첫 페이지 앞에 삽입
      const targetFile = state.files[index];
      let insertIndex = state.mergeOrder.length;
      if (targetFile) {
        const firstPageOfTarget = targetFile.pages.find((p) => !p.isDeleted);
        if (firstPageOfTarget) {
          insertIndex = state.mergeOrder.findIndex(
            (item) => item.pageId === firstPageOfTarget.id
          );
          if (insertIndex === -1) insertIndex = state.mergeOrder.length;
        }
      }
      const newMergeOrderItems = documents.flatMap((doc) =>
        doc.pages
          .filter((page) => !page.isDeleted)
          .map((page) => ({
            fileId: doc.id,
            pageId: page.id
          }))
      );
      const newMergeOrder = [...state.mergeOrder];
      newMergeOrder.splice(insertIndex, 0, ...newMergeOrderItems);
      return { files: newFiles, mergeOrder: newMergeOrder };
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
      status: MERGE_STATUS.IDLE,
      progress: 0,
      errorMessage: null
    }),

  reorderFiles: (fromIndex, toIndex) =>
    set((state) => {
      const newFiles = [...state.files];
      const [movedFile] = newFiles.splice(fromIndex, 1);
      newFiles.splice(toIndex, 0, movedFile);
      // mergeOrder도 재계산 (파일 순서 기반)
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

      // 이동할 파일의 활성 페이지 ID들
      const movingPageIds = new Set(
        fileToMove.pages.filter((p) => !p.isDeleted).map((p) => p.id)
      );

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
      const newMergeOrder = [...orderWithoutMovingFile];
      newMergeOrder.splice(insertIndex, 0, ...itemsToInsert);

      return { mergeOrder: newMergeOrder };
    }),

  // 파일 확장/축소
  toggleExpand: (fileId) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === fileId ? { ...file, isExpanded: !file.isExpanded } : file
      )
    })),

  expandAll: () =>
    set((state) => ({
      files: state.files.map((file) => ({ ...file, isExpanded: true }))
    })),

  collapseAll: () =>
    set((state) => ({
      files: state.files.map((file) => ({ ...file, isExpanded: false }))
    })),

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
        const newPages = [...file.pages];
        const [movedPage] = newPages.splice(fromIndex, 1);
        newPages.splice(toIndex, 0, movedPage);
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
            const newPages = [...mergeFile.pages];
            const [movedPage] = newPages.splice(fromIndex, 1);
            newPages.splice(targetIndex, 0, movedPage);
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

      return {
        files: filesWithoutPage.map((file) => {
          if (file.id === targetFileId) {
            const newPages = [...file.pages];
            newPages.splice(targetIndex, 0, movedPage!);
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
    set({
      errorMessage: message,
      status: message ? MERGE_STATUS.ERROR : MERGE_STATUS.IDLE
    }),

  reset: () => set(initialState)
}));

// Selector hooks
export const useMergeFiles = () => useMergeStore((state) => state.files);
export const useMergeOrder = () => useMergeStore((state) => state.mergeOrder);
export const useMergeStatus = () => useMergeStore((state) => state.status);
export const useMergeProgress = () => useMergeStore((state) => state.progress);

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
  useMergeStore((state) => {
    const file = state.files.find((candidate) => candidate.id === fileId);
    return file?.pages.filter((page) => !page.isDeleted) ?? [];
  });

// 특정 파일 찾기
export const useFile = (fileId: string) =>
  useMergeStore((state) =>
    state.files.find((candidate) => candidate.id === fileId)
  );
