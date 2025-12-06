import { PDFDocument } from 'pdf-lib';
import fse from 'fs-extra';
import type { PdfInfo } from '../types/ipc-schema';

export class PdfMetadataService {
  async getPdfInfo(filePath: string): Promise<PdfInfo> {
    const pdfBytes = await fse.readFile(filePath);
    const pdf = await PDFDocument.load(pdfBytes);

    return {
      pageCount: pdf.getPageCount(),
      title: pdf.getTitle(),
    };
  }
}

// 싱글톤 인스턴스
export const pdfMetadataService = new PdfMetadataService();
