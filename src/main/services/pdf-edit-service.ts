import { PDFDocument, degrees } from "pdf-lib";
import fse from "fs-extra";
import type {
  PageOperation,
  RotationDegrees,
  RotatePageRequest
} from "../types/ipc-schema";
import { ROTATION_DEGREES } from "../types/ipc-schema";

export interface EditOptions {
  filePath: string;
  operations: PageOperation[];
}

export class PdfEditService {
  // 개별 페이지 회전 (즉시 파일 저장)
  async rotatePageAndSave(request: RotatePageRequest): Promise<void> {
    const { filePath, pageIndex, rotationDegrees } = request;

    const pdfBytes = await fse.readFile(filePath);
    const pdf = await PDFDocument.load(pdfBytes);
    const pageCount = pdf.getPageCount();

    if (pageIndex < 0 || pageIndex >= pageCount) {
      throw new Error(`Invalid page index: ${pageIndex}`);
    }

    const page = pdf.getPage(pageIndex);
    const currentRotation = page.getRotation().angle;
    const newRotation = (currentRotation + rotationDegrees) % 360;
    page.setRotation(degrees(newRotation));

    const modifiedBytes = await pdf.save();
    await fse.writeFile(filePath, modifiedBytes);
  }

  async applyOperations(options: EditOptions): Promise<void> {
    const { filePath, operations } = options;

    const pdfBytes = await fse.readFile(filePath);
    let pdf = await PDFDocument.load(pdfBytes);

    for (const operation of operations) {
      pdf = await this.applyOperation(pdf, operation);
    }

    const modifiedBytes = await pdf.save();
    await fse.writeFile(filePath, modifiedBytes);
  }

  private async applyOperation(
    pdf: PDFDocument,
    operation: PageOperation
  ): Promise<PDFDocument> {
    switch (operation.type) {
      case "delete":
        return this.deletePages(pdf, operation.pageIndices);
      case "reorder":
        return this.reorderPages(
          pdf,
          operation.newOrder ?? operation.pageIndices
        );
      case "rotate":
        return this.rotatePages(
          pdf,
          operation.pageIndices,
          operation.rotationDegrees ?? ROTATION_DEGREES.CW_90
        );
      default:
        return pdf;
    }
  }

  private async deletePages(
    sourcePdf: PDFDocument,
    pageIndicesToDelete: number[]
  ): Promise<PDFDocument> {
    const pageCount = sourcePdf.getPageCount();
    const deleteSet = new Set(pageIndicesToDelete);

    // 삭제할 페이지를 제외한 인덱스 목록
    const remainingIndices = Array.from(
      { length: pageCount },
      (_, pageIndex) => pageIndex
    ).filter((pageIndex) => !deleteSet.has(pageIndex));

    if (remainingIndices.length === 0) {
      throw new Error("Cannot delete all pages from PDF");
    }

    // 새 PDF 생성 후 남은 페이지만 복사
    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(sourcePdf, remainingIndices);

    for (const page of copiedPages) {
      newPdf.addPage(page);
    }

    return newPdf;
  }

  private async reorderPages(
    sourcePdf: PDFDocument,
    newOrder: number[]
  ): Promise<PDFDocument> {
    const pageCount = sourcePdf.getPageCount();

    // 유효성 검사
    if (newOrder.length !== pageCount) {
      throw new Error("New order must include all pages");
    }

    const orderSet = new Set(newOrder);
    if (orderSet.size !== pageCount) {
      throw new Error("New order contains duplicate indices");
    }

    for (const index of newOrder) {
      if (index < 0 || index >= pageCount) {
        throw new Error(`Invalid page index: ${index}`);
      }
    }

    // 새 순서로 페이지 복사
    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(sourcePdf, newOrder);

    for (const page of copiedPages) {
      newPdf.addPage(page);
    }

    return newPdf;
  }

  private async rotatePages(
    sourcePdf: PDFDocument,
    pageIndicesToRotate: number[],
    rotationDegrees: RotationDegrees
  ): Promise<PDFDocument> {
    const pageCount = sourcePdf.getPageCount();

    // 유효성 검사
    for (const index of pageIndicesToRotate) {
      if (index < 0 || index >= pageCount) {
        throw new Error(`Invalid page index: ${index}`);
      }
    }

    // 각 페이지 회전 적용
    const rotateSet = new Set(pageIndicesToRotate);
    for (let i = 0; i < pageCount; i++) {
      if (rotateSet.has(i)) {
        const page = sourcePdf.getPage(i);
        const currentRotation = page.getRotation().angle;
        const newRotation = (currentRotation + rotationDegrees) % 360;
        page.setRotation(degrees(newRotation));
      }
    }

    return sourcePdf;
  }
}

// 싱글톤 인스턴스
export const pdfEditService = new PdfEditService();
