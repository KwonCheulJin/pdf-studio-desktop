import type {
  PdfDocument,
  PdfPage,
  MergeOrderItem
} from "../model/pdf-document";
import { FLAT_CARD_TYPE } from "../constants/flat-card";

/**
 * 평면화된 카드 타입 (파일 그룹 또는 페이지)
 */
export type FlatCard =
  | {
      type: typeof FLAT_CARD_TYPE.FILE;
      file: PdfDocument;
      fileIndex: number;
      flatIndex: number;
      /** 이 그룹에 포함된 페이지 수 */
      groupPageCount: number;
      /** 그룹의 첫 페이지 ID (드롭 위치 계산용) */
      firstPageId: string;
    }
  | {
      type: typeof FLAT_CARD_TYPE.PAGE;
      file: PdfDocument;
      page: PdfPage;
      fileIndex: number;
      pageIndex: number;
      flatIndex: number;
      isFirstPage: boolean;
      /** 이 그룹의 첫 페이지인지 (연속된 같은 파일 페이지 중) */
      isFirstOfGroup: boolean;
    };

/**
 * mergeOrder 기반 그룹
 * 연속된 같은 파일의 페이지들을 그룹화
 */
interface MergeOrderGroup {
  fileId: string;
  pageIds: string[];
}

/**
 * flattenFileGrid 함수의 매개변수
 */
interface FlattenFileGridParams {
  files: PdfDocument[];
  mergeOrder: MergeOrderItem[];
}

/**
 * mergeOrder를 연속된 파일별로 그룹화
 */
function groupMergeOrder(mergeOrder: MergeOrderItem[]): MergeOrderGroup[] {
  if (mergeOrder.length === 0) return [];

  const groups: MergeOrderGroup[] = [];
  let currentGroup: MergeOrderGroup | null = null;

  for (const item of mergeOrder) {
    if (currentGroup === null || currentGroup.fileId !== item.fileId) {
      // 새 그룹 시작
      currentGroup = { fileId: item.fileId, pageIds: [item.pageId] };
      groups.push(currentGroup);
    } else {
      // 현재 그룹에 추가
      currentGroup.pageIds.push(item.pageId);
    }
  }

  return groups;
}

/**
 * mergeOrder 기반으로 파일 배열을 평면화된 카드 배열로 변환
 *
 * - mergeOrder의 순서를 따름
 * - 연속된 같은 파일의 페이지는 그룹화
 * - 펼침 상태(isExpanded)에 따라:
 *   - 펼침: 각 페이지를 개별 카드로 표시
 *   - 접힘: 그룹 전체를 하나의 카드로 표시
 *
 * @param params.files PDF 문서 배열
 * @param params.mergeOrder 병합 순서 배열
 * @returns 평면화된 카드 배열
 */
export function flattenFileGrid({
  files,
  mergeOrder
}: FlattenFileGridParams): FlatCard[] {
  // mergeOrder가 비어있으면 기존 파일 순서 사용
  if (mergeOrder.length === 0) {
    return flattenFileGridLegacy(files);
  }

  // 파일 ID로 빠른 조회를 위한 맵
  const fileMap = new Map(files.map((f) => [f.id, f]));

  // 파일별 인덱스 맵 (files 배열에서의 원래 위치)
  const fileIndexMap = new Map(files.map((f, idx) => [f.id, idx]));

  // mergeOrder를 연속된 파일별로 그룹화
  const groups = groupMergeOrder(mergeOrder);

  let flatIndex = 0;
  const result: FlatCard[] = [];

  for (const group of groups) {
    const file = fileMap.get(group.fileId);
    if (!file) continue;

    const fileIndex = fileIndexMap.get(group.fileId) ?? 0;

    // 그룹에 해당하는 페이지들 찾기
    const groupPages = group.pageIds
      .map((pageId) => file.pages.find((p) => p.id === pageId))
      .filter((p): p is PdfPage => p !== undefined && !p.isDeleted);

    if (groupPages.length === 0) continue;

    if (file.isExpanded) {
      // 펼침: 각 페이지를 개별 카드로
      groupPages.forEach((page, idx) => {
        const pageIndex = file.pages.findIndex((p) => p.id === page.id);
        result.push({
          type: FLAT_CARD_TYPE.PAGE,
          file,
          page,
          fileIndex,
          pageIndex,
          flatIndex: flatIndex++,
          isFirstPage: page.sourcePageIndex === 0,
          isFirstOfGroup: idx === 0
        });
      });
    } else {
      // 접힘: 그룹 전체를 하나의 카드로
      result.push({
        type: FLAT_CARD_TYPE.FILE,
        file,
        fileIndex,
        flatIndex: flatIndex++,
        groupPageCount: groupPages.length,
        firstPageId: groupPages[0].id
      });
    }
  }

  return result;
}

/**
 * 기존 방식: files 배열 순서대로 평면화 (mergeOrder 없을 때 사용)
 */
function flattenFileGridLegacy(files: PdfDocument[]): FlatCard[] {
  let flatIndex = 0;

  return files.flatMap((file, fileIndex): FlatCard[] => {
    const visiblePages = file.pages.filter((page) => !page.isDeleted);

    if (visiblePages.length === 0) return [];

    if (file.isExpanded) {
      // 펼침: 각 페이지가 개별 카드 (삭제된 페이지 제외)
      return visiblePages.map((page, pageIndex) => ({
        type: FLAT_CARD_TYPE.PAGE,
        file,
        page,
        fileIndex,
        pageIndex,
        flatIndex: flatIndex++,
        isFirstPage: pageIndex === 0,
        isFirstOfGroup: pageIndex === 0
      }));
    }

    // 접힘: 파일 하나가 하나의 카드
    return [
      {
        type: FLAT_CARD_TYPE.FILE,
        file,
        fileIndex,
        flatIndex: flatIndex++,
        groupPageCount: visiblePages.length,
        firstPageId: visiblePages[0].id
      }
    ];
  });
}
