import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import fse from "fs-extra";
import path from "node:path";
import { app } from "electron";
import type { ConvertResult } from "../types/ipc-schema";
import { APP_CONFIG } from "../config/constants";

export interface ConvertOptions {
  tiffPath: string;
  outputDir?: string;
}

export class FileConverterService {
  async convertTiffToPdf(options: ConvertOptions): Promise<ConvertResult> {
    const { tiffPath, outputDir } = options;

    // TIFF 파일 메타데이터 확인
    const metadata = await sharp(tiffPath).metadata();
    const pageCount = metadata.pages ?? 1;

    const pdf = await PDFDocument.create();

    // 멀티페이지 TIFF 처리
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const imageBuffer = await this.extractTiffPage(tiffPath, pageIndex);
      await this.addImageToPdf(pdf, imageBuffer);
    }

    const pdfBytes = await pdf.save();
    const outputPath = this.generateOutputPath(tiffPath, outputDir);

    await fse.ensureDir(path.dirname(outputPath));
    await fse.writeFile(outputPath, pdfBytes);

    return {
      outputPdfPath: outputPath,
      pageCount: pdf.getPageCount()
    };
  }

  private async extractTiffPage(
    tiffPath: string,
    pageIndex: number
  ): Promise<Buffer> {
    // sharp로 특정 페이지 추출 후 PNG로 변환 (pdf-lib 호환)
    return sharp(tiffPath, { page: pageIndex }).png().toBuffer();
  }

  private async addImageToPdf(
    pdf: PDFDocument,
    imageBuffer: Buffer
  ): Promise<void> {
    const image = await pdf.embedPng(imageBuffer);
    const { width, height } = image.scale(1);

    const page = pdf.addPage([width, height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width,
      height
    });
  }

  private generateOutputPath(tiffPath: string, outputDir?: string): string {
    const baseName = path.basename(tiffPath, path.extname(tiffPath));
    const dir =
      outputDir ??
      path.join(app.getPath("documents"), APP_CONFIG.OUTPUT_DIRECTORY_NAME);
    return path.join(dir, `${baseName}.pdf`);
  }
}

// 싱글톤 인스턴스
export const fileConverterService = new FileConverterService();
