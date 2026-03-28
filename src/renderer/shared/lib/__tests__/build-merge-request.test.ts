import { describe, it, expect } from "vitest";
import { buildMergeRequest } from "../build-merge-request";
import type {
  PdfDocument,
  MergeOrderItem
} from "@/renderer/shared/model/pdf-document";
import { PAGE_ROTATION } from "@/renderer/shared/constants/page-state";

function createTestDocument(
  id: string,
  path: string,
  pageCount: number,
  deletedPageIndices: number[] = []
): PdfDocument {
  return {
    id,
    path,
    name: path.split("/").pop() ?? path,
    pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      id: `page-${id}-${index}`,
      sourceDocumentId: id,
      sourcePageIndex: index,
      rotation: PAGE_ROTATION.DEG_0,
      isDeleted: deletedPageIndices.includes(index)
    }))
  };
}

describe("buildMergeRequest", () => {
  describe("mergeOrder가 비어있을 때 (파일 순서대로 전체 병합)", () => {
    it("단일 파일의 모든 페이지를 포함한 요청 반환", () => {
      const file = createTestDocument("f1", "/docs/a.pdf", 3);
      const result = buildMergeRequest({ files: [file], mergeOrder: [] });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("/docs/a.pdf");
      expect(result.files[0].pages).toEqual([0, 1, 2]);
    });

    it("삭제된 페이지는 제외", () => {
      const file = createTestDocument("f1", "/docs/a.pdf", 3, [1]);
      const result = buildMergeRequest({ files: [file], mergeOrder: [] });

      expect(result.files[0].pages).toEqual([0, 2]);
    });

    it("여러 파일을 순서대로 포함", () => {
      const file1 = createTestDocument("f1", "/docs/a.pdf", 2);
      const file2 = createTestDocument("f2", "/docs/b.pdf", 2);
      const result = buildMergeRequest({
        files: [file1, file2],
        mergeOrder: []
      });

      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe("/docs/a.pdf");
      expect(result.files[1].path).toBe("/docs/b.pdf");
    });

    it("빈 파일 배열이면 빈 files 반환", () => {
      const result = buildMergeRequest({ files: [], mergeOrder: [] });
      expect(result.files).toHaveLength(0);
    });
  });

  describe("mergeOrder가 있을 때 (순서 기반 병합)", () => {
    it("단일 파일의 페이지를 mergeOrder 순서대로 반환", () => {
      const file = createTestDocument("f1", "/docs/a.pdf", 3);
      const mergeOrder: MergeOrderItem[] = [
        { fileId: "f1", pageId: "page-f1-2" },
        { fileId: "f1", pageId: "page-f1-0" },
        { fileId: "f1", pageId: "page-f1-1" }
      ];
      const result = buildMergeRequest({ files: [file], mergeOrder });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].pages).toEqual([2, 0, 1]);
    });

    it("연속된 같은 파일 페이지를 하나의 segment로 묶음", () => {
      const file1 = createTestDocument("f1", "/docs/a.pdf", 3);
      const file2 = createTestDocument("f2", "/docs/b.pdf", 3);
      const mergeOrder: MergeOrderItem[] = [
        { fileId: "f1", pageId: "page-f1-0" },
        { fileId: "f1", pageId: "page-f1-1" },
        { fileId: "f2", pageId: "page-f2-0" }
      ];
      const result = buildMergeRequest({
        files: [file1, file2],
        mergeOrder
      });

      expect(result.files).toHaveLength(2);
      expect(result.files[0]).toEqual({ path: "/docs/a.pdf", pages: [0, 1] });
      expect(result.files[1]).toEqual({ path: "/docs/b.pdf", pages: [0] });
    });

    it("파일이 교차하면 별도 segment로 분리", () => {
      const file1 = createTestDocument("f1", "/docs/a.pdf", 3);
      const file2 = createTestDocument("f2", "/docs/b.pdf", 3);
      const mergeOrder: MergeOrderItem[] = [
        { fileId: "f2", pageId: "page-f2-0" },
        { fileId: "f1", pageId: "page-f1-0" },
        { fileId: "f1", pageId: "page-f1-1" },
        { fileId: "f2", pageId: "page-f2-1" },
        { fileId: "f2", pageId: "page-f2-2" },
        { fileId: "f1", pageId: "page-f1-2" }
      ];
      const result = buildMergeRequest({
        files: [file1, file2],
        mergeOrder
      });

      expect(result.files).toHaveLength(4);
      expect(result.files[0]).toEqual({ path: "/docs/b.pdf", pages: [0] });
      expect(result.files[1]).toEqual({ path: "/docs/a.pdf", pages: [0, 1] });
      expect(result.files[2]).toEqual({ path: "/docs/b.pdf", pages: [1, 2] });
      expect(result.files[3]).toEqual({ path: "/docs/a.pdf", pages: [2] });
    });

    it("존재하지 않는 fileId는 건너뜀 (같은 파일의 연속으로 처리)", () => {
      const file = createTestDocument("f1", "/docs/a.pdf", 2);
      const mergeOrder: MergeOrderItem[] = [
        { fileId: "f1", pageId: "page-f1-0" },
        { fileId: "nonexistent", pageId: "page-x-0" },
        { fileId: "f1", pageId: "page-f1-1" }
      ];
      const result = buildMergeRequest({ files: [file], mergeOrder });

      // nonexistent는 건너뛰고, f1이 연속으로 인식되어 하나의 segment로 묶임
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("/docs/a.pdf");
      expect(result.files[0].pages).toEqual([0, 1]);
    });

    it("mergeOrder가 비어 있지 않아도 segment가 없으면 빈 files 반환", () => {
      const mergeOrder: MergeOrderItem[] = [
        { fileId: "nonexistent", pageId: "page-x-0" }
      ];
      const result = buildMergeRequest({ files: [], mergeOrder });
      expect(result.files).toHaveLength(0);
    });
  });
});
