import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import sharp from "sharp";
import {
  cleanupTestFixtures,
  ensureTestFixturesDir,
  getPageCount,
  getOutputDir
} from "./test-helpers";
import { FileConverterService } from "../file-converter-service";

// Electron app mock
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "documents") return "/tmp/pdf-studio-test";
      return "/tmp";
    }
  }
}));

async function createTestTiff(
  pageCount: number,
  filename: string
): Promise<string> {
  const dir = await ensureTestFixturesDir();
  const filePath = path.join(dir, filename);

  // 단일 페이지 TIFF 생성
  const width = 200;
  const height = 300;

  // 단순한 단일 페이지 TIFF 생성
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .tiff()
    .toFile(filePath);

  return filePath;
}

describe("FileConverterService", () => {
  let service: FileConverterService;
  let outputDir: string;

  beforeAll(async () => {
    service = new FileConverterService();
    outputDir = await getOutputDir();
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  describe("convertTiffToPdf", () => {
    it("단일 페이지 TIFF를 PDF로 변환할 수 있다", async () => {
      const tiffPath = await createTestTiff(1, "single-page.tiff");

      const result = await service.convertTiffToPdf({
        tiffPath,
        outputDir
      });

      expect(result.outputPdfPath).toContain(".pdf");
      expect(result.pageCount).toBe(1);
      expect(await fse.pathExists(result.outputPdfPath)).toBe(true);
      expect(await getPageCount(result.outputPdfPath)).toBe(1);
    });

    it("변환된 PDF 파일명이 원본 TIFF 파일명을 기반으로 한다", async () => {
      const tiffPath = await createTestTiff(1, "my-document.tiff");

      const result = await service.convertTiffToPdf({
        tiffPath,
        outputDir
      });

      expect(path.basename(result.outputPdfPath)).toBe("my-document.pdf");
    });

    it("outputDir을 지정하지 않으면 기본 경로에 저장된다", async () => {
      const tiffPath = await createTestTiff(1, "default-path.tiff");

      const result = await service.convertTiffToPdf({
        tiffPath
      });

      expect(result.outputPdfPath).toContain("PDF Studio");
      expect(await fse.pathExists(result.outputPdfPath)).toBe(true);

      // cleanup
      await fse.remove(result.outputPdfPath);
    });

    it("존재하지 않는 TIFF 파일은 에러가 발생한다", async () => {
      await expect(
        service.convertTiffToPdf({
          tiffPath: "/non-existent/file.tiff",
          outputDir
        })
      ).rejects.toThrow();
    });
  });
});
