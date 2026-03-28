import type { PdfDocument, MergeOrderItem } from "../model/pdf-document";
import type { FilePayload } from "@/main/types/ipc-schema";

/**
 * buildMergeRequest 함수의 매개변수
 */
interface BuildMergeRequestParams {
  files: PdfDocument[];
  mergeOrder: MergeOrderItem[];
}

/**
 * buildMergeRequest 함수의 반환값
 */
interface BuildMergeRequestResult {
  files: FilePayload[];
}

/**
 * mergeOrder를 기반으로 병합 요청 생성
 * 연속된 같은 파일의 페이지들을 그룹화하여 FilePayload 배열 생성
 *
 * @example
 * mergeOrder: [2-1, 1-1, 1-2, 1-3, 2-2, 2-3, 3-1, 3-2, 3-3]
 * →
 * files: [
 *   { path: "file2.pdf", pages: [0] },
 *   { path: "file1.pdf", pages: [0, 1, 2] },
 *   { path: "file2.pdf", pages: [1, 2] },
 *   { path: "file3.pdf", pages: [0, 1, 2] }
 * ]
 */
export function buildMergeRequest({
  files,
  mergeOrder
}: BuildMergeRequestParams): BuildMergeRequestResult {
  if (mergeOrder.length === 0) {
    // mergeOrder가 비어있으면 files 순서대로 전체 병합
    return {
      files: files.map((file) => ({
        path: file.path,
        pages: file.pages
          .filter((page) => !page.isDeleted)
          .map((page) => page.sourcePageIndex)
      }))
    };
  }

  // 파일 ID로 빠른 조회를 위한 맵
  const fileMap = new Map(files.map((f) => [f.id, f]));

  // 페이지 ID로 sourcePageIndex 조회를 위한 맵
  const pageIndexMap = new Map<string, number>();
  for (const file of files) {
    for (const page of file.pages) {
      pageIndexMap.set(page.id, page.sourcePageIndex);
    }
  }

  const result = mergeOrder.reduce<FilePayload[]>((accumulator, item) => {
    const file = fileMap.get(item.fileId);
    if (!file) return accumulator;

    const pageIndex = pageIndexMap.get(item.pageId);
    if (pageIndex === undefined) return accumulator;

    const last = accumulator[accumulator.length - 1];
    if (last && last.path === file.path) {
      // 같은 파일의 연속 페이지 → 새 payload로 교체 (불변)
      return [
        ...accumulator.slice(0, -1),
        { path: last.path, pages: [...(last.pages ?? []), pageIndex] }
      ];
    }

    // 새 파일 시작
    return [...accumulator, { path: file.path, pages: [pageIndex] }];
  }, []);

  return { files: result };
}
