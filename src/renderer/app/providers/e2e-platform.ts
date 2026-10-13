import type {
  ErrorCode,
  MergeProgress,
  MergeRequest,
  OpenedFile
} from "@/renderer/shared/api/bindings";
import {
  getPdfCacheStats,
  type PdfCacheStats
} from "@/renderer/shared/lib/pdfjs";
import {
  createMockPlatform,
  toPlatformError,
  type CopyFileParams,
  type DesktopPlatform,
  type MockMergeOutput,
  type MockPdfFile,
  type NativeFileDropEvent,
  type PickSavePathOptions,
  type PlatformError
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

/** 일부러 실패시킬 호출. 코드는 Rust `ErrorCode`(바인딩) 값을 쓴다. */
export interface E2eMockFailures {
  /** 경로 → `openFiles`가 그 파일에 돌려줄 오류 코드(파일별 실패) */
  openFiles?: Record<string, ErrorCode>;
  /** 있으면 `copyFile`이 이 코드로 실패한다. */
  copyFile?: ErrorCode;
}

/** `mergePdfs` 한 번의 흉내. 진행률을 차례로 보낸 뒤 `failCode`가 있으면 그 코드로 실패한다. */
export interface E2eMergeScript {
  progress: MergeProgress[];
  /** IPC로 온 값처럼 넘기므로 바인딩에 없는 코드도 넣을 수 있다(모르는 코드 표시 확인용). */
  failCode?: string;
  /** 실패를 일으킨 입력 파일(Rust `AppError.path`). 없으면 `null` */
  failPath?: string;
}

export interface E2eMockSeed {
  files: E2eMockFile[];
  /** 열기 다이얼로그를 열 때마다 앞에서부터 하나씩 고를 경로 목록. 다 쓰면 `files`를 모두 고른다. */
  dialogPicks?: string[][];
  failures?: E2eMockFailures;
  /** `mergePdfs`를 부를 때마다 앞에서부터 하나씩 쓴다. 다 쓰면 mock 그대로 성공한다. */
  mergeScripts?: E2eMergeScript[];
  /** 있으면 `temp` 출력 병합 결과가 이 경로·파일 이름이 된다. */
  mergeOutput?: MockMergeOutput;
  /** 있으면 `readThirdPartyNotices`가 이 원문을 돌려준다. 없으면 리소스 없음 오류다. */
  thirdPartyNotices?: string;
}

/** 작업 취소를 Rust처럼 알리는 코드 */
const CANCELLED_CODE = "CANCELLED" satisfies ErrorCode;

/** 파일을 쓰거나 지우거나 작업을 멈추는 플랫폼 호출 */
export const E2E_WRITE_METHOD = {
  MERGE_PDFS: "mergePdfs",
  CANCEL_JOB: "cancelJob",
  COPY_FILE: "copyFile",
  DISCARD_TEMP: "discardTemp"
} as const;

interface MergePdfsCall {
  method: typeof E2E_WRITE_METHOD.MERGE_PDFS;
  request: MergeRequest;
}

interface CancelJobCall {
  method: typeof E2E_WRITE_METHOD.CANCEL_JOB;
  jobId: string;
}

interface CopyFileCall extends CopyFileParams {
  method: typeof E2E_WRITE_METHOD.COPY_FILE;
}

interface DiscardTempCall {
  method: typeof E2E_WRITE_METHOD.DISCARD_TEMP;
  path: string;
}

export type E2eWriteCall =
  | MergePdfsCall
  | CancelJobCall
  | CopyFileCall
  | DiscardTempCall;

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
    /**
     * 테스트가 넣으면 병합 요청을 이 Promise가 풀릴 때까지 붙잡는다(진행 오버레이 확인용).
     * 붙잡힌 동안 `cancelJob`이 오면 바로 `CANCELLED`로 실패한다.
     */
    __E2E_HOLD_MERGE__?: Promise<void>;
    /** `__E2E_HOLD_MERGE__`를 푸는 함수. 테스트가 함께 넣는다. */
    __E2E_RELEASE_MERGE__?: () => void;
    /** 앱이 저장 다이얼로그(`pickSavePath`)를 연 옵션을 부른 순서대로 기록하는 곳 */
    __E2E_MOCK_SAVE_DIALOGS__?: PickSavePathOptions[];
  }
}

function decodeBase64(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

function toMockFile({ bytesBase64, ...file }: E2eMockFile): MockPdfFile {
  return bytesBase64 ? { ...file, bytes: decodeBase64(bytesBase64) } : file;
}

interface SeededErrorParams {
  code: string;
  path?: string;
  detail: string;
}

/** Rust가 보낸 `AppError`처럼 만든다. 코드 확인은 앱이 IPC 값을 받을 때와 같은 경로를 탄다. */
function seededError({ code, path, detail }: SeededErrorParams): PlatformError {
  return toPlatformError({
    code,
    message: `E2E 시드 실패: ${detail}`,
    path: path ?? null
  });
}

/** 쓰기 계열 호출을 위임 전에 기록한다. 거부된 요청도 남는다. */
function recordWrites(
  platform: DesktopPlatform,
  writes: E2eWriteCall[]
): DesktopPlatform {
  return {
    ...platform,
    mergePdfs: async (params) => {
      writes.push({
        method: E2E_WRITE_METHOD.MERGE_PDFS,
        request: params.request
      });
      return platform.mergePdfs(params);
    },
    cancelJob: (jobId) => {
      writes.push({ method: E2E_WRITE_METHOD.CANCEL_JOB, jobId });
      return platform.cancelJob(jobId);
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

interface InjectFailuresParams {
  platform: DesktopPlatform;
  failures: E2eMockFailures;
  mergeScripts: E2eMergeScript[];
}

/**
 * 시드대로 실패·진행률을 흉내 낸다. `mergePdfs`는 스크립트의 진행률을 보낸 뒤
 * `__E2E_HOLD_MERGE__`를 기다리고, 그동안 같은 작업의 `cancelJob`이 오면
 * Rust처럼 `CANCELLED`로 실패한다.
 */
function injectFailures({
  platform,
  failures,
  mergeScripts
}: InjectFailuresParams): DesktopPlatform {
  const openFailures = failures.openFiles ?? {};
  const cancelledJobs = new Set<string>();
  const cancelWaiters = new Map<string, () => void>();

  const toSeededResult = (opened: OpenedFile): OpenedFile => {
    const code = openFailures[opened.sourcePath];
    if (code === undefined) return opened;
    return {
      status: "error",
      sourcePath: opened.sourcePath,
      error: {
        code,
        message: `E2E 시드 실패: ${opened.sourcePath}`,
        path: opened.sourcePath
      }
    };
  };

  return {
    ...platform,
    openFiles: async (paths) =>
      (await platform.openFiles(paths)).map(toSeededResult),
    mergePdfs: async (params) => {
      const { jobId } = params.request;
      const script = mergeScripts.shift();
      for (const progress of script?.progress ?? []) {
        params.onProgress?.(progress);
      }
      const cancelled = new Promise<void>((resolve) => {
        cancelWaiters.set(jobId, resolve);
      });
      await Promise.race([window.__E2E_HOLD_MERGE__, cancelled]);
      cancelWaiters.delete(jobId);
      if (cancelledJobs.has(jobId)) {
        throw seededError({ code: CANCELLED_CODE, detail: jobId });
      }
      if (script?.failCode !== undefined) {
        throw seededError({
          code: script.failCode,
          path: script.failPath,
          detail: jobId
        });
      }
      return platform.mergePdfs(params);
    },
    cancelJob: async (jobId) => {
      cancelledJobs.add(jobId);
      cancelWaiters.get(jobId)?.();
      await platform.cancelJob(jobId);
    },
    copyFile: async (params) => {
      if (failures.copyFile !== undefined) {
        throw seededError({
          code: failures.copyFile,
          detail: params.destination
        });
      }
      await platform.copyFile(params);
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

interface RecordSaveDialogsParams {
  platform: DesktopPlatform;
  saveDialogs: PickSavePathOptions[];
}

/** 저장 다이얼로그를 연 옵션(기본 파일 이름)을 위임 전에 기록한다. */
function recordSaveDialogs({
  platform,
  saveDialogs
}: RecordSaveDialogsParams): DesktopPlatform {
  return {
    ...platform,
    pickSavePath: (options) => {
      saveDialogs.push(options);
      return platform.pickSavePath(options);
    }
  };
}

/** 설정을 페이지 저장소에 두는 키 앞부분. 새로고침해도 남아 재시작처럼 확인할 수 있다. */
const SETTING_STORAGE_PREFIX = "e2e-setting:";

/**
 * 설정 읽기·쓰기를 `localStorage`에 둔다(Tauri `plugin-store` 파일 대신).
 * Playwright는 테스트마다 새 브라우저 컨텍스트라 테스트끼리 섞이지 않는다.
 */
function persistSettings(platform: DesktopPlatform): DesktopPlatform {
  return {
    ...platform,
    getSetting: async (key) => {
      const stored = localStorage.getItem(`${SETTING_STORAGE_PREFIX}${key}`);
      return stored === null ? undefined : JSON.parse(stored);
    },
    setSetting: async ({ key, value }) => {
      localStorage.setItem(
        `${SETTING_STORAGE_PREFIX}${key}`,
        JSON.stringify(value)
      );
    }
  };
}

/** 시드가 없으면(개발 서버를 브라우저로 그냥 열었을 때) 빈 가짜 플랫폼 */
export function createE2ePlatform(): DesktopPlatform {
  const seed = window.__E2E_MOCK_SEED__;
  if (!seed) {
    return persistSettings(createMockPlatform());
  }
  const writes: E2eWriteCall[] = [];
  const reads: string[] = [];
  const saveDialogs: PickSavePathOptions[] = [];
  window.__E2E_MOCK_WRITES__ = writes;
  window.__E2E_MOCK_READS__ = reads;
  window.__E2E_MOCK_SAVE_DIALOGS__ = saveDialogs;
  window.__E2E_PDF_CACHE_STATS__ = getPdfCacheStats;
  const mockPlatform = createMockPlatform({
    files: seed.files.map(toMockFile),
    dialogPicks: seed.dialogPicks,
    mergeOutput: seed.mergeOutput,
    thirdPartyNotices: seed.thirdPartyNotices
  });
  window.__E2E_FILE_DROP__ = mockPlatform.simulateFileDrop;
  const seededPlatform = injectFailures({
    platform: mockPlatform,
    failures: seed.failures ?? {},
    mergeScripts: [...(seed.mergeScripts ?? [])]
  });
  return persistSettings(
    recordSaveDialogs({
      platform: recordReads({
        platform: recordWrites(seededPlatform, writes),
        reads
      }),
      saveDialogs
    })
  );
}
