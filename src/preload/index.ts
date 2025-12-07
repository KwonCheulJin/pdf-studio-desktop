import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  MergeRequest,
  MergeResult,
  MergeProgress,
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
  DeleteFileRequest
} from "../main/types/ipc-schema";

const api = {
  // Commands (Renderer → Main)
  mergePdf: (request: MergeRequest): Promise<void> =>
    ipcRenderer.invoke("pdf.merge:start", request),

  editPdf: (request: EditPageRequest): Promise<void> =>
    ipcRenderer.invoke("pdf.edit:apply", request),

  rotatePage: (request: RotatePageRequest): Promise<void> =>
    ipcRenderer.invoke("pdf.page:rotate", request),

  convertTiff: (request: ConvertTiffRequest): Promise<ConvertResult> =>
    ipcRenderer.invoke("file.convert.tiff", request),

  getPdfInfo: (filePath: string): Promise<PdfInfo> =>
    ipcRenderer.invoke("file.meta.get-pdf-info", filePath),

  readPdf: (request: ReadPdfRequest): Promise<ReadPdfResult> =>
    ipcRenderer.invoke("file.read:pdf", request),

  // Dialogs
  showOpenDialog: (options?: DialogOpenOptions): Promise<string[]> =>
    ipcRenderer.invoke("dialog.show-open", options),

  showSaveDialog: (options?: DialogSaveOptions): Promise<string | undefined> =>
    ipcRenderer.invoke("dialog.show-save", options),
  saveFile: (request: CopyFileRequest): Promise<void> =>
    ipcRenderer.invoke("file.save.copy", request),
  deleteFile: (request: DeleteFileRequest): Promise<void> =>
    ipcRenderer.invoke("file.delete", request),

  // Events (Main → Renderer)
  onMergeProgress: (callback: (progress: MergeProgress) => void): void => {
    ipcRenderer.on("pdf.merge:progress", (_event, data: MergeProgress) =>
      callback(data)
    );
  },

  onMergeComplete: (callback: (result: MergeResult) => void): void => {
    ipcRenderer.on("pdf.merge:complete", (_event, data: MergeResult) =>
      callback(data)
    );
  },

  // Cleanup listeners
  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Theme
  onThemeChanged: (callback: (isDark: boolean) => void): void => {
    ipcRenderer.on("theme:changed", (_event, isDark: boolean) =>
      callback(isDark)
    );
  },

  // Logging
  log: (level: string, message: string): void => {
    ipcRenderer.send("app.log", { level, message });
  },

  // File utilities (드래그 앤 드롭용)
  getFilePath: (file: File): string => webUtils.getPathForFile(file)
};

contextBridge.exposeInMainWorld("api", api);

// Type export for Renderer
export type ApiType = typeof api;
