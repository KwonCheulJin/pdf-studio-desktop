import { contextBridge, ipcRenderer } from 'electron';
import type {
  MergeRequest,
  MergeResult,
  MergeProgress,
  EditPageRequest,
  ConvertTiffRequest,
  ConvertResult,
  PdfInfo,
  DialogOpenOptions,
  DialogSaveOptions,
} from '../main/types/ipc-schema';

const api = {
  // Commands (Renderer → Main)
  mergePdf: (request: MergeRequest): Promise<void> =>
    ipcRenderer.invoke('pdf.merge:start', request),

  editPdf: (request: EditPageRequest): Promise<void> =>
    ipcRenderer.invoke('pdf.edit:apply', request),

  convertTiff: (request: ConvertTiffRequest): Promise<ConvertResult> =>
    ipcRenderer.invoke('file.convert.tiff', request),

  getPdfInfo: (filePath: string): Promise<PdfInfo> =>
    ipcRenderer.invoke('file.meta.get-pdf-info', filePath),

  // Dialogs
  showOpenDialog: (options?: DialogOpenOptions): Promise<string[]> =>
    ipcRenderer.invoke('dialog.show-open', options),

  showSaveDialog: (options?: DialogSaveOptions): Promise<string | undefined> =>
    ipcRenderer.invoke('dialog.show-save', options),

  // Events (Main → Renderer)
  onMergeProgress: (callback: (progress: MergeProgress) => void): void => {
    ipcRenderer.on('pdf.merge:progress', (_event, data: MergeProgress) =>
      callback(data)
    );
  },

  onMergeComplete: (callback: (result: MergeResult) => void): void => {
    ipcRenderer.on('pdf.merge:complete', (_event, data: MergeResult) =>
      callback(data)
    );
  },

  // Cleanup listeners
  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Logging
  log: (level: string, message: string): void => {
    ipcRenderer.send('app.log', { level, message });
  },
};

contextBridge.exposeInMainWorld('api', api);

// Type export for Renderer
export type ApiType = typeof api;
