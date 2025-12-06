import { PDFDocument } from 'pdf-lib';
import fse from 'fs-extra';
import path from 'node:path';
import { app } from 'electron';
import type { FilePayload, MergeResult } from '../types/ipc-schema';

export interface MergeOptions {
  files: FilePayload[];
  outputPath?: string;
  onProgress?: (current: number, total: number) => void;
}

export class PdfMergeService {
  async merge(options: MergeOptions): Promise<MergeResult> {
    const { files, outputPath, onProgress } = options;

    if (files.length === 0) {
      throw new Error('No PDF files provided');
    }

    const mergedPdf = await PDFDocument.create();
    const total = files.length;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pdfBytes = await fse.readFile(file.path);
      const sourcePdf = await PDFDocument.load(pdfBytes);

      // 특정 페이지만 복사하거나 전체 페이지 복사
      const pageIndices = file.pages ?? this.getAllPageIndices(sourcePdf);
      const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);

      for (const page of copiedPages) {
        mergedPdf.addPage(page);
      }

      onProgress?.(i + 1, total);
    }

    const mergedBytes = await mergedPdf.save();
    const finalPath = outputPath ?? this.generateOutputPath();

    await fse.ensureDir(path.dirname(finalPath));
    await fse.writeFile(finalPath, mergedBytes);

    return {
      outputPath: finalPath,
      totalPages: mergedPdf.getPageCount(),
    };
  }

  private getAllPageIndices(pdf: PDFDocument): number[] {
    const pageCount = pdf.getPageCount();
    return Array.from({ length: pageCount }, (_, i) => i);
  }

  private generateOutputPath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(app.getPath('documents'), 'PDF Studio');
    return path.join(outputDir, `merged-${timestamp}.pdf`);
  }
}

// 싱글톤 인스턴스
export const pdfMergeService = new PdfMergeService();
