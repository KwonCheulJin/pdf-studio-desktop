import type { MergeSource } from "@/renderer/shared/api/bindings";
import type {
  PdfDocument,
  MergeOrderItem
} from "@/renderer/entities/merge-plan";

/**
 * buildMergeSources 함수의 매개변수
 */
interface BuildMergeSourcesParams {
  files: PdfDocument[];
  mergeOrder: MergeOrderItem[];
}

/**
 * mergeOrder를 기반으로 병합 소스(`merge_pdfs` 요청의 `sources`) 생성
 * 연속된 같은 파일의 페이지들을 하나의 소스로 묶고, 페이지마다 스토어의 회전값을 담는다.
 *
 * @example
 * mergeOrder: [2-1, 1-1, 1-2, 1-3, 2-2, 2-3, 3-1, 3-2, 3-3]
 * →
 * [
 *   { path: "file2.pdf", pages: [{ index: 0, rotation }] },
 *   { path: "file1.pdf", pages: [{ index: 0, rotation }, …, { index: 2, rotation }] },
 *   { path: "file2.pdf", pages: [{ index: 1, rotation }, { index: 2, rotation }] },
 *   { path: "file3.pdf", pages: [{ index: 0, rotation }, …, { index: 2, rotation }] }
 * ]
 */
export function buildMergeSources({
  files,
  mergeOrder
}: BuildMergeSourcesParams): MergeSource[] {
  if (mergeOrder.length === 0) {
    // mergeOrder가 비어있으면 files 순서대로 전체 병합
    return files.map((file) => ({
      path: file.path,
      pages: file.pages
        .filter((page) => !page.isDeleted)
        .map((page) => ({
          index: page.sourcePageIndex,
          rotation: page.rotation
        }))
    }));
  }

  // 파일 ID로 빠른 조회를 위한 맵
  const fileMap = new Map(files.map((f) => [f.id, f]));

  // 페이지 ID로 페이지 조회를 위한 맵
  const pageMap = new Map(
    files.flatMap((file) => file.pages.map((page) => [page.id, page] as const))
  );

  return mergeOrder.reduce<MergeSource[]>((accumulator, item) => {
    const file = fileMap.get(item.fileId);
    if (!file) return accumulator;

    const page = pageMap.get(item.pageId);
    if (!page) return accumulator;

    const mergePage = { index: page.sourcePageIndex, rotation: page.rotation };
    const last = accumulator[accumulator.length - 1];
    if (last && last.path === file.path) {
      // 같은 파일의 연속 페이지 → 새 소스로 교체 (불변)
      return [
        ...accumulator.slice(0, -1),
        { path: last.path, pages: [...last.pages, mergePage] }
      ];
    }

    // 새 파일 시작
    return [...accumulator, { path: file.path, pages: [mergePage] }];
  }, []);
}
