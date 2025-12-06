import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import fse from 'fs-extra';
import {
  createTestPdf,
  cleanupTestFixtures,
  getPageCount,
  getOutputDir,
} from './test-helpers';
import { PdfMergeService } from '../pdf-merge-service';

// Electron app mock
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'documents') return '/tmp/pdf-studio-test';
      return '/tmp';
    },
  },
}));

describe('PdfMergeService', () => {
  let service: PdfMergeService;
  let testPdf1: string;
  let testPdf2: string;
  let testPdf3: string;
  let outputDir: string;

  beforeAll(async () => {
    service = new PdfMergeService();
    outputDir = await getOutputDir();
    testPdf1 = await createTestPdf(3, `merge-test1-${Date.now()}.pdf`);
    testPdf2 = await createTestPdf(5, `merge-test2-${Date.now()}.pdf`);
    testPdf3 = await createTestPdf(2, `merge-test3-${Date.now()}.pdf`);
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  describe('merge', () => {
    it('두 PDF 파일을 병합하면 페이지 수가 합쳐진다', async () => {
      const outputPath = path.join(outputDir, 'merged-two.pdf');

      const result = await service.merge({
        files: [{ path: testPdf1 }, { path: testPdf2 }],
        outputPath,
      });

      expect(result.outputPath).toBe(outputPath);
      expect(result.totalPages).toBe(8); // 3 + 5
      expect(await fse.pathExists(outputPath)).toBe(true);
      expect(await getPageCount(outputPath)).toBe(8);
    });

    it('세 개 이상의 PDF 파일을 병합할 수 있다', async () => {
      const outputPath = path.join(outputDir, 'merged-three.pdf');

      const result = await service.merge({
        files: [{ path: testPdf1 }, { path: testPdf2 }, { path: testPdf3 }],
        outputPath,
      });

      expect(result.totalPages).toBe(10); // 3 + 5 + 2
      expect(await getPageCount(outputPath)).toBe(10);
    });

    it('특정 페이지만 선택하여 병합할 수 있다', async () => {
      const outputPath = path.join(outputDir, 'merged-partial.pdf');

      const result = await service.merge({
        files: [
          { path: testPdf1, pages: [0, 2] }, // 1, 3번 페이지만
          { path: testPdf2, pages: [0] }, // 1번 페이지만
        ],
        outputPath,
      });

      expect(result.totalPages).toBe(3); // 2 + 1
      expect(await getPageCount(outputPath)).toBe(3);
    });

    it('빈 파일 배열로 병합하면 에러가 발생한다', async () => {
      await expect(
        service.merge({
          files: [],
          outputPath: path.join(outputDir, 'empty.pdf'),
        })
      ).rejects.toThrow('No PDF files provided');
    });

    it('진행률 콜백이 호출된다', async () => {
      const outputPath = path.join(outputDir, 'merged-progress.pdf');
      const progressCalls: Array<{ current: number; total: number }> = [];

      await service.merge({
        files: [{ path: testPdf1 }, { path: testPdf2 }, { path: testPdf3 }],
        outputPath,
        onProgress: (current, total) => {
          progressCalls.push({ current, total });
        },
      });

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0]).toEqual({ current: 1, total: 3 });
      expect(progressCalls[1]).toEqual({ current: 2, total: 3 });
      expect(progressCalls[2]).toEqual({ current: 3, total: 3 });
    });

    it('outputPath가 없으면 기본 경로에 저장된다', async () => {
      const result = await service.merge({
        files: [{ path: testPdf1 }],
      });

      expect(result.outputPath).toContain('merged-');
      expect(result.outputPath).toContain('.pdf');
      expect(await fse.pathExists(result.outputPath)).toBe(true);

      // cleanup
      await fse.remove(result.outputPath);
    });
  });
});
