import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import fse from "fs-extra";
import path from "node:path";
import type { PdfInfo } from "../types/ipc-schema";

const TIFF_EXTENSIONS = [".tif", ".tiff"];

function isTiffFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TIFF_EXTENSIONS.includes(ext);
}

export class PdfMetadataService {
  async getPdfInfo(filePath: string): Promise<PdfInfo> {
    if (isTiffFile(filePath)) {
      return this.getTiffInfo(filePath);
    }
    return this.getPdfFileInfo(filePath);
  }

  private async getPdfFileInfo(filePath: string): Promise<PdfInfo> {
    const pdfBytes = await fse.readFile(filePath);
    const pdf = await PDFDocument.load(pdfBytes);

    return {
      pageCount: pdf.getPageCount(),
      title: pdf.getTitle()
    };
  }

  private async getTiffInfo(filePath: string): Promise<PdfInfo> {
    const metadata = await sharp(filePath).metadata();
    const fileName = path.basename(filePath, path.extname(filePath));

    return {
      pageCount: metadata.pages ?? 1,
      title: fileName
    };
  }
}

// 싱글톤 인스턴스
export const pdfMetadataService = new PdfMetadataService();
