import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { openPdfDocument } from "./pdfjs-setup";

/** 읽는 중에 닫혔는지와 닫을 때 destroy할 작업 */
interface LoadState {
  loadingTask: PDFDocumentLoadingTask | null;
  isClosed: boolean;
}

interface DocumentEntry {
  referenceCount: number;
  /** 처음 `acquire`할 때 읽기 시작한다. `retain`만 있으면 읽지 않는다. */
  documentPromise: Promise<PDFDocumentProxy> | null;
  loadState: LoadState;
}

interface LoadParams {
  path: string;
  loadState: LoadState;
}

interface LoadedTask {
  path: string;
  loadingTask: PDFDocumentLoadingTask;
}

export interface PdfDocumentCacheOptions {
  /** 파일 바이트 읽기(`platform.readPdf`). 경로마다 열려 있는 동안 한 번만 부른다. */
  readBytes: (path: string) => Promise<Uint8Array>;
  /** 마지막 참조가 풀려 문서를 닫은 뒤 */
  onClose: (path: string) => void;
}

const CLOSED_BEFORE_LOAD = "문서를 읽는 중에 닫았습니다.";

/**
 * 경로당 `PDFDocumentProxy` 하나. 참조 수를 세고 마지막 참조가 풀리면 `destroy()`한다.
 * 같은 경로를 동시에 요청하면 같은 Promise를 나눠 쓴다.
 * `retain`은 읽지 않고 참조만 잡아, 한 번 연 문서가 화면 전환 사이에 닫히지 않게 한다.
 */
export class PdfDocumentCache {
  readonly #entries = new Map<string, DocumentEntry>();
  readonly #options: PdfDocumentCacheOptions;
  /** 개발 서버(E2E)에서만: 만든 문서가 실제로 destroy됐는지 확인하는 기록 */
  readonly #loadedTasks: LoadedTask[] | null = import.meta.env.DEV ? [] : null;

  constructor(options: PdfDocumentCacheOptions) {
    this.#options = options;
  }

  retain(path: string): void {
    this.#reference(path);
  }

  acquire(path: string): Promise<PDFDocumentProxy> {
    const entry = this.#reference(path);
    if (entry.documentPromise) {
      return entry.documentPromise;
    }
    const documentPromise = this.#load({ path, loadState: entry.loadState });
    // 모두 놓고 떠난 뒤의 실패는 받을 곳이 없다. 기다리는 쪽은 각자 처리한다.
    documentPromise.catch(() => undefined);
    entry.documentPromise = documentPromise;
    return documentPromise;
  }

  release(path: string): void {
    const entry = this.#entries.get(path);
    if (!entry) {
      return;
    }
    entry.referenceCount -= 1;
    if (entry.referenceCount > 0) {
      return;
    }
    this.#entries.delete(path);
    entry.loadState.isClosed = true;
    entry.loadState.loadingTask?.destroy().catch(() => undefined);
    this.#options.onClose(path);
  }

  /** destroy되지 않은 문서의 경로. 개발 서버에서만 채워진다. */
  getLiveDocumentPaths(): string[] {
    return (this.#loadedTasks ?? [])
      .filter(({ loadingTask }) => !loadingTask.destroyed)
      .map(({ path }) => path);
  }

  #reference(path: string): DocumentEntry {
    const existing = this.#entries.get(path);
    if (existing) {
      existing.referenceCount += 1;
      return existing;
    }
    const entry: DocumentEntry = {
      referenceCount: 1,
      documentPromise: null,
      loadState: { loadingTask: null, isClosed: false }
    };
    this.#entries.set(path, entry);
    return entry;
  }

  async #load({ path, loadState }: LoadParams): Promise<PDFDocumentProxy> {
    const data = await this.#options.readBytes(path);
    if (loadState.isClosed) {
      throw new Error(CLOSED_BEFORE_LOAD);
    }
    const loadingTask = openPdfDocument(data);
    loadState.loadingTask = loadingTask;
    this.#loadedTasks?.push({ path, loadingTask });
    return loadingTask.promise;
  }
}
