import { describe, it, expect } from "vitest";
import { flattenFileGrid } from "../flatten-file-grid";
import type { PdfDocument, PdfPage } from "../../model/pdf-document";
import { PAGE_ROTATION } from "../../constants/page-state";
import { FLAT_CARD_TYPE } from "../../constants/flat-card";

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
  isExpanded: boolean,
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
    pages,
    isExpanded
  };
}

describe("flattenFileGrid", () => {
  it("빈 배열 입력 시 빈 배열 반환", () => {
    const result = flattenFileGrid({ files: [], mergeOrder: [] });
    expect(result).toEqual([]);
  });

  it("접힌 파일 하나 → 파일 카드 하나 생성", () => {
    const doc = createTestDocument("doc1", 3, false);
    const result = flattenFileGrid({ files: [doc], mergeOrder: [] });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: FLAT_CARD_TYPE.FILE,
      file: doc,
      fileIndex: 0,
      flatIndex: 0,
      groupPageCount: 3
    });
  });

  it("펼친 파일 하나 → 페이지별 카드 생성", () => {
    const doc = createTestDocument("doc1", 3, true);
    const result = flattenFileGrid({ files: [doc], mergeOrder: [] });

    expect(result).toHaveLength(3);

    // 첫 번째 페이지 확인
    expect(result[0]).toMatchObject({
      type: FLAT_CARD_TYPE.PAGE,
      file: doc,
      page: doc.pages[0],
      fileIndex: 0,
      pageIndex: 0,
      flatIndex: 0,
      isFirstPage: true,
      isFirstOfGroup: true
    });

    // 두 번째 페이지 확인
    expect(result[1]).toMatchObject({
      type: FLAT_CARD_TYPE.PAGE,
      fileIndex: 0,
      pageIndex: 1,
      flatIndex: 1,
      isFirstPage: false
    });

    // 세 번째 페이지 확인
    expect(result[2]).toMatchObject({
      type: FLAT_CARD_TYPE.PAGE,
      fileIndex: 0,
      pageIndex: 2,
      flatIndex: 2,
      isFirstPage: false
    });
  });

  it("삭제된 페이지는 필터링", () => {
    const doc = createTestDocument("doc1", 3, true, [1]); // 두 번째 페이지 삭제
    const result = flattenFileGrid({ files: [doc], mergeOrder: [] });

    expect(result).toHaveLength(2);
    expect(
      result[0].type === FLAT_CARD_TYPE.PAGE && result[0].page.sourcePageIndex
    ).toBe(0);
    expect(
      result[1].type === FLAT_CARD_TYPE.PAGE && result[1].page.sourcePageIndex
    ).toBe(2);
  });

  it("여러 파일 혼합 (접힌 파일 + 펼친 파일)", () => {
    const doc1 = createTestDocument("doc1", 2, false); // 접힘
    const doc2 = createTestDocument("doc2", 3, true); // 펼침
    const doc3 = createTestDocument("doc3", 1, false); // 접힘

    const result = flattenFileGrid({
      files: [doc1, doc2, doc3],
      mergeOrder: []
    });

    expect(result).toHaveLength(5); // 1 + 3 + 1

    // doc1 (접힘)
    expect(result[0]).toMatchObject({
      type: FLAT_CARD_TYPE.FILE,
      fileIndex: 0,
      flatIndex: 0,
      groupPageCount: 2
    });

    // doc2 (펼침) - 3개 페이지
    expect(result[1]).toMatchObject({
      type: FLAT_CARD_TYPE.PAGE,
      fileIndex: 1,
      pageIndex: 0,
      flatIndex: 1,
      isFirstPage: true
    });
    expect(result[2]).toMatchObject({
      type: FLAT_CARD_TYPE.PAGE,
      fileIndex: 1,
      pageIndex: 1,
      flatIndex: 2
    });
    expect(result[3]).toMatchObject({
      type: FLAT_CARD_TYPE.PAGE,
      fileIndex: 1,
      pageIndex: 2,
      flatIndex: 3
    });

    // doc3 (접힘)
    expect(result[4]).toMatchObject({
      type: FLAT_CARD_TYPE.FILE,
      fileIndex: 2,
      flatIndex: 4,
      groupPageCount: 1
    });
  });

  it("flatIndex가 연속적으로 증가", () => {
    const doc1 = createTestDocument("doc1", 2, true);
    const doc2 = createTestDocument("doc2", 1, false);
    const doc3 = createTestDocument("doc3", 2, true);

    const result = flattenFileGrid({
      files: [doc1, doc2, doc3],
      mergeOrder: []
    });

    // flatIndex가 0부터 연속적으로 증가하는지 확인
    result.forEach((card, index) => {
      expect(card.flatIndex).toBe(index);
    });
  });

  it("모든 페이지가 삭제된 펼친 파일 → 빈 결과", () => {
    const doc = createTestDocument("doc1", 2, true, [0, 1]); // 모든 페이지 삭제
    const result = flattenFileGrid({ files: [doc], mergeOrder: [] });

    expect(result).toHaveLength(0);
  });

  describe("mergeOrder 기반 순서", () => {
    it("mergeOrder 순서대로 카드 생성", () => {
      const doc1 = createTestDocument("doc1", 2, false);
      const doc2 = createTestDocument("doc2", 2, false);

      // doc2 -> doc1 순서로 mergeOrder 설정
      const mergeOrder = [
        { fileId: "doc2", pageId: "page-doc2-0" },
        { fileId: "doc2", pageId: "page-doc2-1" },
        { fileId: "doc1", pageId: "page-doc1-0" },
        { fileId: "doc1", pageId: "page-doc1-1" }
      ];

      const result = flattenFileGrid({
        files: [doc1, doc2],
        mergeOrder
      });

      expect(result).toHaveLength(2); // 둘 다 접힌 상태
      expect(result[0].file.id).toBe("doc2");
      expect(result[1].file.id).toBe("doc1");
    });

    it("파일이 분리된 경우 각 그룹이 별도 카드로 표시", () => {
      const doc1 = createTestDocument("doc1", 3, false);
      const doc2 = createTestDocument("doc2", 3, true); // 펼침

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
        mergeOrder
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
