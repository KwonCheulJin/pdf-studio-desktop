interface RenderedPageEntry {
  path: string;
  urlPromise: Promise<string>;
  /** 렌더가 끝나 만든 `blob:` URL. 지울 때 revoke한다. */
  url: string | null;
  byteSize: number;
  /** 지금 화면이 쓰는 수. 0인 항목만 LRU로 내보낸다. */
  useCount: number;
}

export interface AcquireRenderedPageParams {
  key: string;
  path: string;
  render: () => Promise<Blob>;
}

interface KeepParams {
  key: string;
  entry: RenderedPageEntry;
  blob: Blob;
}

export interface RenderedPageCacheOptions {
  /** 쓰지 않는 항목을 이 크기(바이트)까지만 남긴다. */
  maxBytes: number;
}

const RENDER_DISCARDED = "렌더가 끝나기 전에 캐시에서 지웠습니다.";

/**
 * 렌더 결과(`blob:` URL) LRU. 쓰는 중인 항목은 내보내지 않고,
 * 쓰지 않는 항목은 합계가 `maxBytes`를 넘으면 오래 안 쓴 것부터 revoke한다.
 * Map의 삽입 순서를 사용 순서로 쓴다(앞쪽이 가장 오래됨).
 */
export class RenderedPageCache {
  readonly #entries = new Map<string, RenderedPageEntry>();
  readonly #maxBytes: number;
  #totalBytes = 0;

  constructor({ maxBytes }: RenderedPageCacheOptions) {
    this.#maxBytes = maxBytes;
  }

  acquire({ key, path, render }: AcquireRenderedPageParams): Promise<string> {
    const existing = this.#entries.get(key);
    if (existing) {
      existing.useCount += 1;
      this.#entries.delete(key);
      this.#entries.set(key, existing);
      return existing.urlPromise;
    }
    const urlPromise = render().then((blob) =>
      this.#keep({ key, entry, blob })
    );
    const entry: RenderedPageEntry = {
      path,
      urlPromise,
      url: null,
      byteSize: 0,
      useCount: 1
    };
    this.#entries.set(key, entry);
    // 실패한 항목은 지워 다음 요청이 다시 그리게 한다.
    urlPromise.catch(() => {
      if (this.#entries.get(key) === entry) {
        this.#entries.delete(key);
      }
    });
    return urlPromise;
  }

  release(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) {
      return;
    }
    entry.useCount -= 1;
    this.#evictIdle();
  }

  /** 문서를 닫을 때 그 문서의 항목을 쓰는 중이어도 모두 지운다. */
  removePath(path: string): void {
    for (const [key, entry] of this.#entries) {
      if (entry.path === path) {
        this.#remove(key, entry);
      }
    }
  }

  /** 항목마다 그 경로 하나(개수 확인용) */
  getEntryPaths(): string[] {
    return Array.from(this.#entries.values(), (entry) => entry.path);
  }

  #keep({ key, entry, blob }: KeepParams): string {
    if (this.#entries.get(key) !== entry) {
      throw new Error(RENDER_DISCARDED);
    }
    entry.url = URL.createObjectURL(blob);
    entry.byteSize = blob.size;
    this.#totalBytes += blob.size;
    this.#evictIdle();
    return entry.url;
  }

  #evictIdle(): void {
    for (const [key, entry] of this.#entries) {
      if (this.#totalBytes <= this.#maxBytes) {
        return;
      }
      if (entry.useCount === 0 && entry.url) {
        this.#remove(key, entry);
      }
    }
  }

  #remove(key: string, entry: RenderedPageEntry): void {
    this.#entries.delete(key);
    if (entry.url) {
      URL.revokeObjectURL(entry.url);
      this.#totalBytes -= entry.byteSize;
    }
  }
}
