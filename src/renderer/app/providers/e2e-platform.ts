import type { MergeRequest } from "@/renderer/shared/api/bindings";
import {
  getPdfCacheStats,
  type PdfCacheStats
} from "@/renderer/shared/lib/pdfjs";
import {
  createMockPlatform,
  type CopyFileParams,
  type DesktopPlatform,
  type MockPdfFile,
  type NativeFileDropEvent
} from "@/renderer/shared/platform";

/**
 * 브라우저 E2E(Playwright)용 가짜 플랫폼.
 * 개발 서버에서만 불린다(`platform-provider.ts`의 `import.meta.env.DEV` 분기).
 * 프로덕션 빌드에서는 그 분기가 상수 false로 접혀 이 모듈이 번들에 들어가지 않는다.
 */

/** 시드 파일 하나. 바이트는 JSON으로 넘겨야 해서 base64로 받는다. */
export interface E2eMockFile extends Omit<MockPdfFile, "bytes"> {
  bytesBase64?: string;
}

export interface E2eMockSeed {
  files: E2eMockFile[];
}

/** 파일을 쓰거나 지우는 플랫폼 호출 */
export const E2E_WRITE_METHOD = {
  MERGE_PDFS: "mergePdfs",
  COPY_FILE: "copyFile",
  DISCARD_TEMP: "discardTemp"
} as const;

interface MergePdfsCall {
  method: typeof E2E_WRITE_METHOD.MERGE_PDFS;
  request: MergeRequest;
}

interface CopyFileCall extends CopyFileParams {
  method: typeof E2E_WRITE_METHOD.COPY_FILE;
}

interface DiscardTempCall {
  method: typeof E2E_WRITE_METHOD.DISCARD_TEMP;
  path: string;
}

export type E2eWriteCall = MergePdfsCall | CopyFileCall | DiscardTempCall;

declare global {
  interface Window {
    /** 테스트가 페이지 로드 전에 넣는 시드(`page.addInitScript`) */
    __E2E_MOCK_SEED__?: E2eMockSeed;
    /** 앱이 쓰기 계열 호출을 기록하는 곳. 테스트가 읽는다. */
    __E2E_MOCK_WRITES__?: E2eWriteCall[];
    /** 앱이 `readPdf`로 읽은 경로를 부른 순서대로 기록하는 곳 */
    __E2E_MOCK_READS__?: string[];
    /** pdf.js 캐시 상태(살아 있는 문서, 렌더 캐시 항목) 조회 */
    __E2E_PDF_CACHE_STATS__?: () => PdfCacheStats;
    /** 창 밖 파일 드래그·드롭을 흉내 낸다. 좌표는 물리 픽셀(CSS 픽셀 × `devicePixelRatio`) */
    __E2E_FILE_DROP__?: (event: NativeFileDropEvent) => void;
  }
}

function decodeBase64(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

function toMockFile({ bytesBase64, ...file }: E2eMockFile): MockPdfFile {
  return bytesBase64 ? { ...file, bytes: decodeBase64(bytesBase64) } : file;
}

/** 쓰기 계열 호출을 위임 전에 기록한다. 거부된 요청도 남는다. */
function recordWrites(
  platform: DesktopPlatform,
  writes: E2eWriteCall[]
): DesktopPlatform {
  return {
    ...platform,
    mergePdfs: (params) => {
      writes.push({
        method: E2E_WRITE_METHOD.MERGE_PDFS,
        request: params.request
      });
      return platform.mergePdfs(params);
    },
    copyFile: (params) => {
      writes.push({ method: E2E_WRITE_METHOD.COPY_FILE, ...params });
      return platform.copyFile(params);
    },
    discardTemp: (path) => {
      writes.push({ method: E2E_WRITE_METHOD.DISCARD_TEMP, path });
      return platform.discardTemp(path);
    }
  };
}

interface RecordReadsParams {
  platform: DesktopPlatform;
  reads: string[];
}

/** `readPdf` 호출 경로를 위임 전에 기록한다. */
function recordReads({ platform, reads }: RecordReadsParams): DesktopPlatform {
  return {
    ...platform,
    readPdf: (path) => {
      reads.push(path);
      return platform.readPdf(path);
    }
  };
}

/** 시드가 없으면(개발 서버를 브라우저로 그냥 열었을 때) 빈 가짜 플랫폼 */
export function createE2ePlatform(): DesktopPlatform {
  const seed = window.__E2E_MOCK_SEED__;
  if (!seed) {
    return createMockPlatform();
  }
  const writes: E2eWriteCall[] = [];
  const reads: string[] = [];
  window.__E2E_MOCK_WRITES__ = writes;
  window.__E2E_MOCK_READS__ = reads;
  window.__E2E_PDF_CACHE_STATS__ = getPdfCacheStats;
  const mockPlatform = createMockPlatform({
    files: seed.files.map(toMockFile)
  });
  window.__E2E_FILE_DROP__ = mockPlatform.simulateFileDrop;
  return recordReads({
    platform: recordWrites(mockPlatform, writes),
    reads
  });
}
