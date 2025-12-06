import fse from "fs-extra";
import type { ReadPdfRequest, ReadPdfResult } from "../types/ipc-schema";

export class FileReaderService {
  async readPdf(request: ReadPdfRequest): Promise<ReadPdfResult> {
    const { filePath } = request;

    const exists = await fse.pathExists(filePath);
    if (!exists) {
      throw new Error(`File not found: ${filePath}`);
    }

    const buffer = await fse.readFile(filePath);
    const data = new Uint8Array(buffer);

    return {
      data,
      fileSize: buffer.length
    };
  }
}

// 싱글톤 인스턴스
export const fileReaderService = new FileReaderService();
