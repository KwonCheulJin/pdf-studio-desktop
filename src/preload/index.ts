import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC_CHANNEL } from "../main/types/ipc-schema";
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
  DeleteFileRequest,
  LogLevel
} from "../main/types/ipc-schema";

const api = {
  // Commands (Renderer → Main)
  mergePdf: (request: MergeRequest): Promise<MergeResult> =>
    ipcRenderer.invoke(IPC_CHANNEL.MERGE_START, request),

  editPdf: (request: EditPageRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNEL.EDIT_APPLY, request),

  rotatePage: (request: RotatePageRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNEL.PAGE_ROTATE, request),

  convertTiff: (request: ConvertTiffRequest): Promise<ConvertResult> =>
    ipcRenderer.invoke(IPC_CHANNEL.CONVERT_TIFF, request),

  getPdfInfo: (filePath: string): Promise<PdfInfo> =>
    ipcRenderer.invoke(IPC_CHANNEL.META_PDF_INFO, filePath),

  readPdf: (request: ReadPdfRequest): Promise<ReadPdfResult> =>
    ipcRenderer.invoke(IPC_CHANNEL.READ_PDF, request),

  // Dialogs
  showOpenDialog: (options?: DialogOpenOptions): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNEL.DIALOG_OPEN, options),

  showSaveDialog: (options?: DialogSaveOptions): Promise<string | undefined> =>
    ipcRenderer.invoke(IPC_CHANNEL.DIALOG_SAVE, options),
  saveFile: (request: CopyFileRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNEL.FILE_COPY, request),
  deleteFile: (request: DeleteFileRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNEL.FILE_DELETE, request),

  // Events (Main → Renderer)
  onMergeProgress: (callback: (progress: MergeProgress) => void): void => {
    ipcRenderer.on(IPC_CHANNEL.MERGE_PROGRESS, (_event, data: MergeProgress) =>
      callback(data)
    );
  },

  onMergeComplete: (callback: (result: MergeResult) => void): void => {
    ipcRenderer.on(IPC_CHANNEL.MERGE_COMPLETE, (_event, data: MergeResult) =>
      callback(data)
    );
  },

  // Cleanup listeners
  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Theme
  onThemeChanged: (callback: (isDark: boolean) => void): void => {
    ipcRenderer.on(IPC_CHANNEL.THEME_CHANGED, (_event, isDark: boolean) =>
      callback(isDark)
    );
  },

  // Logging
  log: (level: LogLevel, message: string): void => {
    ipcRenderer.send(IPC_CHANNEL.APP_LOG, { level, message });
  },

  // File utilities (드래그 앤 드롭용)
  getFilePath: (file: File): string => webUtils.getPathForFile(file)
};

contextBridge.exposeInMainWorld("api", api);

// Type export for Renderer
export type ApiType = typeof api;
