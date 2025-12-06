import type {
  MergeRequest,
  MergeProgress,
  MergeResult,
  EditPageRequest,
  ConvertTiffRequest,
  ConvertResult,
  PdfInfo,
  DialogOpenOptions,
  DialogSaveOptions,
} from '../../../main/types/ipc-schema';

// window.api 타입 정의
declare global {
  interface Window {
    api: {
      mergePdf: (request: MergeRequest) => Promise<void>;
      editPdf: (request: EditPageRequest) => Promise<void>;
      convertTiff: (request: ConvertTiffRequest) => Promise<ConvertResult>;
      getPdfInfo: (filePath: string) => Promise<PdfInfo>;
      showOpenDialog: (options?: DialogOpenOptions) => Promise<string[]>;
      showSaveDialog: (options?: DialogSaveOptions) => Promise<string | undefined>;
      onMergeProgress: (callback: (progress: MergeProgress) => void) => void;
      onMergeComplete: (callback: (result: MergeResult) => void) => void;
      removeAllListeners: (channel: string) => void;
      log: (level: string, message: string) => void;
    };
  }
}

export const ipcClient = {
  merge: {
    start: (request: MergeRequest): Promise<void> => window.api.mergePdf(request),
    onProgress: (callback: (progress: MergeProgress) => void): void =>
      window.api.onMergeProgress(callback),
    onComplete: (callback: (result: MergeResult) => void): void =>
      window.api.onMergeComplete(callback),
    removeListeners: (): void => {
      window.api.removeAllListeners('pdf.merge:progress');
      window.api.removeAllListeners('pdf.merge:complete');
    },
  },
  edit: {
    apply: (request: EditPageRequest): Promise<void> => window.api.editPdf(request),
  },
  convert: {
    tiff: (request: ConvertTiffRequest): Promise<ConvertResult> =>
      window.api.convertTiff(request),
  },
  meta: {
    getPdfInfo: (filePath: string): Promise<PdfInfo> =>
      window.api.getPdfInfo(filePath),
  },
  dialog: {
    open: (options?: DialogOpenOptions): Promise<string[]> =>
      window.api.showOpenDialog(options),
    save: (options?: DialogSaveOptions): Promise<string | undefined> =>
      window.api.showSaveDialog(options),
  },
  log: {
    info: (message: string): void => window.api.log('info', message),
    warn: (message: string): void => window.api.log('warn', message),
    error: (message: string): void => window.api.log('error', message),
  },
};
