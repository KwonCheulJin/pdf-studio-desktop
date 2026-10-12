import {
  OPENABLE_EXTENSIONS,
  type AppError,
  type ErrorCode,
  type MergeResult,
  type OpenedFile,
  type PageInfo
} from "@/renderer/shared/api/bindings";
import {
  FILE_DROP_EVENT_TYPE,
  MERGE_OUTPUT_KIND,
  type DesktopPlatform,
  type FileDropHandler,
  type SettingValue
} from "./desktop-platform";
import { toFileDropEvent, type NativeFileDropEvent } from "./native-file-drop";
import { PlatformError } from "./platform-error";

/** 가짜 파일 하나. `bytes`가 없으면 `readPdf`가 `NOT_FOUND`로 실패한다. */
export interface MockPdfFile {
  path: string;
  displayName: string;
  /** `openFiles`가 돌려줄 쪽별 크기·원본 회전. 쪽 수는 이 길이다. */
  pages: PageInfo[];
  title?: string;
  bytes?: Uint8Array;
  /**
   * TIFF처럼 열 때 PDF로 변환되는 파일이면 `openFiles`가 `pdfPath`로 돌려줄 변환 결과 경로.
   * Rust의 앱 캐시 폴더처럼 고르지 않아도 읽을 수 있고, 바이트는 `bytes`를 쓴다.
   */
  convertedPath?: string;
}

/** 병합 결과를 쓸 임시 경로와 그 파일 이름(`MergeResult`의 같은 필드) */
export type MockMergeOutput = Pick<MergeResult, "outputPath" | "fileName">;

export interface MockPlatformOptions {
  /** 열기 다이얼로그가 고르는 파일들. 드롭으로도 열 수 있다. */
  files?: MockPdfFile[];
  /** 있으면 `temp` 출력 병합이 이 경로에 쓴다. 없으면 작업 ID로 이름을 만든다. */
  mergeOutput?: MockMergeOutput;
  /** `readThirdPartyNotices`가 돌려줄 고지 원문. 없으면 번들에 파일이 없을 때처럼 실패한다. */
  thirdPartyNotices?: string;
}

export interface MockPlatform extends DesktopPlatform {
  /**
   * 창 밖 파일 드래그·드롭을 흉내 낸다. 좌표는 WebView2처럼 물리 픽셀로 받아
   * `devicePixelRatio`로 나눈다. 드롭한 경로는 구독자에게 알리기 전에
   * 허용 목록에 기록한다(Rust가 드롭 이벤트에서 기록하는 것과 같은 순서).
   */
  simulateFileDrop(event: NativeFileDropEvent): void;
}

/** Rust 커맨드가 같은 상황에서 돌려주는 코드 */
const MOCK_ERROR_CODE = {
  NOT_FOUND: "NOT_FOUND",
  PATH_NOT_ALLOWED: "PATH_NOT_ALLOWED",
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  RESOURCE_UNAVAILABLE: "RESOURCE_UNAVAILABLE"
} as const satisfies Record<string, ErrorCode>;

const MOCK_DIRECTORY = {
  TEMP: "/mock/temp",
  SAVE: "/mock/saved"
} as const;

const PERCENT_COMPLETE = 100;

/** Rust `notices::THIRD_PARTY_NOTICES_FILE`(실패 메시지용) */
const THIRD_PARTY_NOTICES_FILE = "THIRD_PARTY_NOTICES.md";

const EXTENSION_SEPARATOR = ".";
const PDF_EXTENSION = "pdf";
const MERGED_FILE_PREFIX = "merged-";

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf(EXTENSION_SEPARATOR) + 1).toLowerCase();
}

/** 이름의 마지막 확장자를 뺀다. 점으로 시작하는 이름(`.gitignore`)은 그대로다. */
function stemOf(name: string): string {
  const separatorIndex = name.lastIndexOf(EXTENSION_SEPARATOR);
  return separatorIndex > 0 ? name.slice(0, separatorIndex) : name;
}

/** Rust `allow_dropped`처럼 열 수 있는 확장자만 기록한다. */
function isOpenable(path: string): boolean {
  const extension = extensionOf(path);
  return OPENABLE_EXTENSIONS.some((openable) => openable === extension);
}

interface RejectedPathParams {
  code:
    | typeof MOCK_ERROR_CODE.PATH_NOT_ALLOWED
    | typeof MOCK_ERROR_CODE.UNSUPPORTED_FILE_TYPE;
  path: string;
}

/** Rust처럼 커맨드가 거부한 경로는 `AppError.path`에 담지 않는다. */
function rejectedPath({ code, path }: RejectedPathParams): AppError {
  return { code, message: path, path: null };
}

/** Rust처럼 열려던 파일이 없으면 그 경로를 `AppError.path`에 담는다. */
function missingFile(path: string): AppError {
  return { code: MOCK_ERROR_CODE.NOT_FOUND, message: path, path };
}

/**
 * 메모리 안 가짜 파일로 동작하는 구현(브라우저 E2E용).
 * 허용 경로 규칙과 에러 코드는 Tauri 커맨드와 같다.
 */
export function createMockPlatform({
  files = [],
  mergeOutput,
  thirdPartyNotices
}: MockPlatformOptions = {}): MockPlatform {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const convertedFiles = new Map(
    files.flatMap((file) =>
      file.convertedPath ? [[file.convertedPath, file] as const] : []
    )
  );
  const pickedPaths = new Set<string>();
  const dropHandlers = new Set<FileDropHandler>();
  /** 저장 다이얼로그에서 고른 경로 → 그 파일 이름 */
  const saveTargets = new Map<string, string>();
  const tempOutputs = new Set<string>();
  const settings = new Map<string, SettingValue>();

  const ensureReadable = (path: string): void => {
    if (
      !pickedPaths.has(path) &&
      !tempOutputs.has(path) &&
      !convertedFiles.has(path)
    ) {
      throw new PlatformError(
        rejectedPath({ code: MOCK_ERROR_CODE.PATH_NOT_ALLOWED, path })
      );
    }
  };

  const ensureTemp = (path: string): void => {
    if (!tempOutputs.has(path)) {
      throw new PlatformError(
        rejectedPath({ code: MOCK_ERROR_CODE.PATH_NOT_ALLOWED, path })
      );
    }
  };

  /** 저장 다이얼로그에서 고른 경로의 파일 이름 */
  const saveTargetName = (path: string): string => {
    const fileName = saveTargets.get(path);
    if (fileName === undefined) {
      throw new PlatformError(
        rejectedPath({ code: MOCK_ERROR_CODE.PATH_NOT_ALLOWED, path })
      );
    }
    return fileName;
  };

  /** Rust `merge`처럼 소스는 허용 목록 안의 PDF만 받는다. */
  const ensureMergeSource = (path: string): void => {
    ensureReadable(path);
    if (extensionOf(path) !== PDF_EXTENSION) {
      throw new PlatformError(
        rejectedPath({ code: MOCK_ERROR_CODE.UNSUPPORTED_FILE_TYPE, path })
      );
    }
  };

  const newTempOutput = (jobId: string): MockMergeOutput => {
    const fileName = `${MERGED_FILE_PREFIX}${jobId}.${PDF_EXTENSION}`;
    return {
      outputPath: `${MOCK_DIRECTORY.TEMP}/${fileName}`,
      fileName
    };
  };

  const openFile = (path: string): OpenedFile => {
    const file = filesByPath.get(path);
    if (!pickedPaths.has(path) || !file) {
      return {
        status: "error",
        sourcePath: path,
        error: file
          ? rejectedPath({ code: MOCK_ERROR_CODE.PATH_NOT_ALLOWED, path })
          : missingFile(path)
      };
    }
    return {
      status: "ok",
      sourcePath: path,
      pdfPath: file.convertedPath ?? path,
      displayName: file.displayName,
      info: {
        pageCount: file.pages.length,
        title: file.title ?? null,
        pages: file.pages
      }
    };
  };

  return {
    pickFiles: async () => {
      for (const file of files) {
        pickedPaths.add(file.path);
      }
      return files.map((file) => file.path);
    },
    pickSavePath: async ({ fileName }) => {
      const path = `${MOCK_DIRECTORY.SAVE}/${fileName}`;
      saveTargets.set(path, fileName);
      return path;
    },
    openFiles: async (paths) => paths.map(openFile),
    // 가짜 경로를 자르지 않고 시드의 표시 이름을 쓴다. 시드에 없는 경로는 그대로 돌려준다.
    fileStem: async (path) => {
      const file = filesByPath.get(path);
      return file ? stemOf(file.displayName) : path;
    },
    readPdf: async (path) => {
      ensureReadable(path);
      const bytes = (filesByPath.get(path) ?? convertedFiles.get(path))?.bytes;
      if (!bytes) {
        throw new PlatformError(missingFile(path));
      }
      return bytes.slice();
    },
    mergePdfs: async ({ request, onProgress }) => {
      for (const source of request.sources) {
        ensureMergeSource(source.path);
      }
      const { output } = request;
      let written: MockMergeOutput;
      if (output.kind === MERGE_OUTPUT_KIND.TEMP) {
        written = mergeOutput ?? newTempOutput(request.jobId);
        tempOutputs.add(written.outputPath);
      } else {
        written = {
          outputPath: output.path,
          fileName: saveTargetName(output.path)
        };
      }
      const pageCount = request.sources.reduce(
        (total, source) => total + source.pages.length,
        0
      );
      onProgress?.({
        stage: "save",
        done: 1,
        total: 1,
        stagePercent: PERCENT_COMPLETE,
        overallPercent: PERCENT_COMPLETE
      });
      return { ...written, pageCount };
    },
    cancelJob: async () => {},
    copyFile: async ({ source, destination }) => {
      ensureTemp(source);
      saveTargetName(destination);
    },
    discardTemp: async (path) => {
      ensureTemp(path);
      tempOutputs.delete(path);
    },
    log: ({ level, message }) => {
      console[level](message);
    },
    onFileDrop: (handler) => {
      dropHandlers.add(handler);
      return () => {
        dropHandlers.delete(handler);
      };
    },
    getSetting: async (key) => settings.get(key),
    setSetting: async ({ key, value }) => {
      settings.set(key, value);
    },
    // Rust처럼 번들 리소스를 못 읽으면 경로 없이 `RESOURCE_UNAVAILABLE`이다.
    readThirdPartyNotices: async () => {
      if (thirdPartyNotices === undefined) {
        throw new PlatformError({
          code: MOCK_ERROR_CODE.RESOURCE_UNAVAILABLE,
          message: THIRD_PARTY_NOTICES_FILE,
          path: null
        });
      }
      return thirdPartyNotices;
    },
    simulateFileDrop: (event) => {
      if (event.type === FILE_DROP_EVENT_TYPE.DROP) {
        for (const path of event.paths) {
          if (filesByPath.has(path) && isOpenable(path)) {
            pickedPaths.add(path);
          }
        }
      }
      const dropEvent = toFileDropEvent({
        event,
        pixelRatio: window.devicePixelRatio
      });
      for (const handler of dropHandlers) {
        handler(dropEvent);
      }
    }
  };
}
