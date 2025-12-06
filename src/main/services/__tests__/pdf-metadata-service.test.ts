import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestPdf,
  createTestPdfWithTitle,
  cleanupTestFixtures,
} from './test-helpers';
import { PdfMetadataService } from '../pdf-metadata-service';

describe('PdfMetadataService', () => {
  let service: PdfMetadataService;
  let testPdf3Pages: string;
  let testPdf10Pages: string;
  let testPdfWithTitle: string;

  beforeAll(async () => {
    service = new PdfMetadataService();
    testPdf3Pages = await createTestPdf(3, 'meta-3pages.pdf');
    testPdf10Pages = await createTestPdf(10, 'meta-10pages.pdf');
    testPdfWithTitle = await createTestPdfWithTitle(5, 'My Document Title');
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  describe('getPdfInfo', () => {
    it('PDF 파일의 페이지 수를 반환한다', async () => {
      const info = await service.getPdfInfo(testPdf3Pages);

      expect(info.pageCount).toBe(3);
    });

    it('페이지 수가 많은 PDF도 정확히 조회한다', async () => {
      const info = await service.getPdfInfo(testPdf10Pages);

      expect(info.pageCount).toBe(10);
    });

    it('PDF 파일의 제목을 반환한다', async () => {
      const info = await service.getPdfInfo(testPdfWithTitle);

      expect(info.pageCount).toBe(5);
      expect(info.title).toBe('My Document Title');
    });

    it('제목이 없는 PDF는 title이 undefined이다', async () => {
      const info = await service.getPdfInfo(testPdf3Pages);

      expect(info.title).toBeUndefined();
    });

    it('존재하지 않는 파일은 에러가 발생한다', async () => {
      await expect(
        service.getPdfInfo('/non-existent/file.pdf')
      ).rejects.toThrow();
    });
  });
});
