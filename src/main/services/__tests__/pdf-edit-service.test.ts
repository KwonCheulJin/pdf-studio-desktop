import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createTestPdf,
  cleanupTestFixtures,
  getPageCount,
  getOutputDir
} from "./test-helpers";
import { PdfEditService } from "../pdf-edit-service";

describe("PdfEditService", () => {
  let service: PdfEditService;
  let outputDir: string;

  beforeEach(async () => {
    service = new PdfEditService();
    outputDir = await getOutputDir();
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  describe("applyOperations - delete", () => {
    it("단일 페이지를 삭제할 수 있다", async () => {
      const testPdf = await createTestPdf(5, `delete-single-${Date.now()}.pdf`);

      await service.applyOperations({
        filePath: testPdf,
        operations: [{ type: "delete", pageIndices: [2] }] // 3번째 페이지 삭제
      });

      expect(await getPageCount(testPdf)).toBe(4);
    });

    it("여러 페이지를 한 번에 삭제할 수 있다", async () => {
      const testPdf = await createTestPdf(5, `delete-multi-${Date.now()}.pdf`);

      await service.applyOperations({
        filePath: testPdf,
        operations: [{ type: "delete", pageIndices: [0, 2, 4] }] // 1, 3, 5번째 페이지 삭제
      });

      expect(await getPageCount(testPdf)).toBe(2);
    });

    it("모든 페이지를 삭제하려고 하면 에러가 발생한다", async () => {
      const testPdf = await createTestPdf(3, `delete-all-${Date.now()}.pdf`);

      await expect(
        service.applyOperations({
          filePath: testPdf,
          operations: [{ type: "delete", pageIndices: [0, 1, 2] }]
        })
      ).rejects.toThrow("Cannot delete all pages from PDF");
    });

    it("첫 번째 페이지를 삭제할 수 있다", async () => {
      const testPdf = await createTestPdf(3, `delete-first-${Date.now()}.pdf`);

      await service.applyOperations({
        filePath: testPdf,
        operations: [{ type: "delete", pageIndices: [0] }]
      });

      expect(await getPageCount(testPdf)).toBe(2);
    });

    it("마지막 페이지를 삭제할 수 있다", async () => {
      const testPdf = await createTestPdf(3, `delete-last-${Date.now()}.pdf`);

      await service.applyOperations({
        filePath: testPdf,
        operations: [{ type: "delete", pageIndices: [2] }]
      });

      expect(await getPageCount(testPdf)).toBe(2);
    });
  });

  describe("applyOperations - reorder", () => {
    it("페이지 순서를 변경할 수 있다", async () => {
      const testPdf = await createTestPdf(3, `reorder-${Date.now()}.pdf`);

      await service.applyOperations({
        filePath: testPdf,
        operations: [{ type: "reorder", pageIndices: [], newOrder: [2, 0, 1] }] // 3, 1, 2 순서로
      });

      expect(await getPageCount(testPdf)).toBe(3);
    });

    it("페이지 순서를 역순으로 변경할 수 있다", async () => {
      const testPdf = await createTestPdf(
        4,
        `reorder-reverse-${Date.now()}.pdf`
      );

      await service.applyOperations({
        filePath: testPdf,
        operations: [
          { type: "reorder", pageIndices: [], newOrder: [3, 2, 1, 0] }
        ]
      });

      expect(await getPageCount(testPdf)).toBe(4);
    });

    it("newOrder 길이가 페이지 수와 다르면 에러가 발생한다", async () => {
      const testPdf = await createTestPdf(
        3,
        `reorder-invalid-${Date.now()}.pdf`
      );

      await expect(
        service.applyOperations({
          filePath: testPdf,
          operations: [{ type: "reorder", pageIndices: [], newOrder: [0, 1] }]
        })
      ).rejects.toThrow("New order must include all pages");
    });

    it("newOrder에 중복 인덱스가 있으면 에러가 발생한다", async () => {
      const testPdf = await createTestPdf(3, `reorder-dup-${Date.now()}.pdf`);

      await expect(
        service.applyOperations({
          filePath: testPdf,
          operations: [
            { type: "reorder", pageIndices: [], newOrder: [0, 0, 1] }
          ]
        })
      ).rejects.toThrow("New order contains duplicate indices");
    });

    it("newOrder에 유효하지 않은 인덱스가 있으면 에러가 발생한다", async () => {
      const testPdf = await createTestPdf(
        3,
        `reorder-invalid-idx-${Date.now()}.pdf`
      );

      await expect(
        service.applyOperations({
          filePath: testPdf,
          operations: [
            { type: "reorder", pageIndices: [], newOrder: [0, 1, 5] }
          ]
        })
      ).rejects.toThrow("Invalid page index: 5");
    });
  });

  describe("applyOperations - multiple operations", () => {
    it("여러 작업을 순차적으로 적용할 수 있다", async () => {
      const testPdf = await createTestPdf(5, `multi-ops-${Date.now()}.pdf`);

      await service.applyOperations({
        filePath: testPdf,
        operations: [
          { type: "delete", pageIndices: [4] }, // 5번째 페이지 삭제 -> 4페이지
          { type: "reorder", pageIndices: [], newOrder: [3, 2, 1, 0] } // 역순 정렬
        ]
      });

      expect(await getPageCount(testPdf)).toBe(4);
    });
  });
});
