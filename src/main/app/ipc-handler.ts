import { ipcMain, dialog, BrowserWindow } from "electron";
import {
  pdfMergeService,
  pdfEditService,
  fileConverterService,
  pdfMetadataService,
  fileReaderService
} from "../services";
import fse from "fs-extra";
import type {
  MergeRequest,
  MergeResult,
  EditPageRequest,
  RotatePageRequest,
  ConvertTiffRequest,
  ConvertResult,
  PdfInfo,
  ReadPdfRequest,
  ReadPdfResult,
  DialogOpenOptions,
  DialogSaveOptions,
  CopyFileRequest,
  DeleteFileRequest,
  LogPayload
} from "../types/ipc-schema";

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

export function registerIpcHandlers(): void {
  // PDF Merge
  ipcMain.handle(
    "pdf.merge:start",
    async (_event, request: MergeRequest): Promise<MergeResult> => {
      const mainWindow = getMainWindow();

      const result = await pdfMergeService.merge({
        files: request.files,
        outputPath: request.outputPath,
        onProgress: (current, total) => {
          if (mainWindow) {
            sendMergeProgress(mainWindow, current, total);
          }
        }
      });

      if (mainWindow) {
        sendMergeComplete(mainWindow, result);
      }

      return result;
    }
  );

  // PDF Edit
  ipcMain.handle(
    "pdf.edit:apply",
    async (_event, request: EditPageRequest): Promise<void> => {
      await pdfEditService.applyOperations({
        filePath: request.filePath,
        operations: request.operations
      });
    }
  );

  // PDF Page Rotate (개별 페이지 회전 - 즉시 파일 저장)
  ipcMain.handle(
    "pdf.page:rotate",
    async (_event, request: RotatePageRequest): Promise<void> => {
      await pdfEditService.rotatePageAndSave(request);
    }
  );

  // TIFF Convert
  ipcMain.handle(
    "file.convert.tiff",
    async (_event, request: ConvertTiffRequest): Promise<ConvertResult> => {
      return fileConverterService.convertTiffToPdf({
        tiffPath: request.tiffPath,
        outputDir: request.outputDir
      });
    }
  );

  // PDF Metadata
  ipcMain.handle(
    "file.meta.get-pdf-info",
    async (_event, filePath: string): Promise<PdfInfo> => {
      return pdfMetadataService.getPdfInfo(filePath);
    }
  );

  // File Read - PDF
  ipcMain.handle(
    "file.read:pdf",
    async (_event, request: ReadPdfRequest): Promise<ReadPdfResult> => {
      return fileReaderService.readPdf(request);
    }
  );

  // Dialog - Open
  ipcMain.handle(
    "dialog.show-open",
    async (_event, options?: DialogOpenOptions): Promise<string[]> => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        filters: options?.filters ?? [
          { name: "PDF Files", extensions: ["pdf"] },
          { name: "TIFF Files", extensions: ["tif", "tiff"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });
      return result.filePaths;
    }
  );

  // Dialog - Save
  ipcMain.handle(
    "dialog.show-save",
    async (
      _event,
      options?: DialogSaveOptions
    ): Promise<string | undefined> => {
      const result = await dialog.showSaveDialog({
        defaultPath: options?.defaultPath,
        filters: [{ name: "PDF Files", extensions: ["pdf"] }]
      });
      return result.filePath;
    }
  );

  // File Save (copy)
  ipcMain.handle(
    "file.save.copy",
    async (_event, request: CopyFileRequest): Promise<void> => {
      await fse.copy(request.sourcePath, request.destinationPath);
    }
  );

  ipcMain.handle(
    "file.delete",
    async (_event, request: DeleteFileRequest): Promise<void> => {
      if (!request.path) return;
      await fse.remove(request.path);
    }
  );

  // App Log
  ipcMain.on("app.log", (_event, payload: LogPayload): void => {
    const { level, message } = payload;
    switch (level) {
      case "error":
        console.error(`[Renderer] ${message}`);
        break;
      case "warn":
        console.warn(`[Renderer] ${message}`);
        break;
      default:
        console.log(`[Renderer] ${message}`);
    }
  });
}

// Progress 이벤트 발송 유틸리티
export function sendMergeProgress(
  window: BrowserWindow,
  current: number,
  total: number
): void {
  window.webContents.send("pdf.merge:progress", {
    current,
    total,
    percentage: Math.round((current / total) * 100)
  });
}

export function sendMergeComplete(
  window: BrowserWindow,
  result: MergeResult
): void {
  window.webContents.send("pdf.merge:complete", result);
}
