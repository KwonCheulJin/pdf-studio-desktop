import { describe, it, expect } from "vitest";
import { flattenFileGrid } from "../flatten-file-grid";
import {
  PAGE_ROTATION,
  type PdfDocument,
  type PdfPage
} from "@/renderer/entities/merge-plan";
import { FLAT_CARD_TYPE } from "../../config/flat-card";

// 테스트용 PdfPage 생성 헬퍼
function createTestPage(
  id: string,
  sourceDocumentId: string,
  sourcePageIndex: number,
  isDeleted = false
): PdfPage {
  return {
    id,
    sourceDocumentId,
    sourcePageIndex,
    rotation: PAGE_ROTATION.DEG_0,
    isDeleted
  };
}

// 테스트용 PdfDocument 생성 헬퍼
function createTestDocument(
  id: string,
  pageCount: number,
  deletedPageIndices: number[] = []
): PdfDocument {
  const pages = Array.from({ length: pageCount }, (_, i) =>
    createTestPage(`page-${id}-${i}`, id, i, deletedPageIndices.includes(i))
  );

  return {
    id,
    path: `/test/${id}.pdf`,
    name: `${id}.pdf`,
    pageCount,
    pages
  };
}

describe("flattenFileGrid", () => {
  it("빈 배열 입력 시 빈 배열 반환", () => {
    const result = flattenFileGrid({ files: [], mergeOrder: [] });
    expect(result).toEqual([]);
  });

  describe("mergeOrder 기반 순서", () => {
    it("mergeOrder 순서대로 카드 생성", () => {
      const doc1 = createTestDocument("doc1", 2);
      const doc2 = createTestDocument("doc2", 2);

      // doc2 -> doc1 순서로 mergeOrder 설정
      const mergeOrder = [
        { fileId: "doc2", pageId: "page-doc2-0" },
        { fileId: "doc2", pageId: "page-doc2-1" },
        { fileId: "doc1", pageId: "page-doc1-0" },
        { fileId: "doc1", pageId: "page-doc1-1" }
      ];

      const result = flattenFileGrid({
        files: [doc1, doc2],
        mergeOrder,
        collapsedGroups: new Set(["group_page-doc2-0", "group_page-doc1-0"])
      });

      expect(result).toHaveLength(2); // 둘 다 접힌 상태
      expect(result[0].file.id).toBe("doc2");
      expect(result[1].file.id).toBe("doc1");
    });

    it("파일이 분리된 경우 각 그룹이 별도 카드로 표시", () => {
      const doc1 = createTestDocument("doc1", 3);
      const doc2 = createTestDocument("doc2", 3);

      // doc2의 첫 페이지 -> doc1 전체 -> doc2의 나머지 페이지
      const mergeOrder = [
        { fileId: "doc2", pageId: "page-doc2-0" },
        { fileId: "doc1", pageId: "page-doc1-0" },
        { fileId: "doc1", pageId: "page-doc1-1" },
        { fileId: "doc1", pageId: "page-doc1-2" },
        { fileId: "doc2", pageId: "page-doc2-1" },
        { fileId: "doc2", pageId: "page-doc2-2" }
      ];

      const result = flattenFileGrid({
        files: [doc1, doc2],
        mergeOrder,
        collapsedGroups: new Set(["group_page-doc1-0"])
      });

      // doc2(펼침): page-0 -> doc1(접힘): 3p -> doc2(펼침): page-1, page-2
      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({
        type: FLAT_CARD_TYPE.PAGE,
        file: doc2
      });
      expect(result[1]).toMatchObject({
        type: FLAT_CARD_TYPE.FILE,
        file: doc1,
        groupPageCount: 3
      });
      expect(result[2]).toMatchObject({
        type: FLAT_CARD_TYPE.PAGE,
        file: doc2
      });
      expect(result[3]).toMatchObject({
        type: FLAT_CARD_TYPE.PAGE,
        file: doc2
      });
    });
  });
});
