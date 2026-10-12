import {
  OPENABLE_EXTENSIONS,
  type OpenedFile,
  type PageInfo
} from "@/renderer/shared/api/bindings";
import {
  FILE_DROP_EVENT_TYPE,
  MERGE_OUTPUT_KIND,
  type DesktopPlatform,
  type FileDropHandler
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
}

export interface MockPlatformOptions {
  /** 열기 다이얼로그가 고르는 파일들. 드롭으로도 열 수 있다. */
  files?: MockPdfFile[];
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
  PATH_NOT_ALLOWED: "PATH_NOT_ALLOWED"
} as const;

const MOCK_DIRECTORY = {
  TEMP: "/mock/temp",
  SAVE: "/mock/saved"
} as const;

const PERCENT_COMPLETE = 100;

const EXTENSION_SEPARATOR = ".";

/** Rust `allow_dropped`처럼 열 수 있는 확장자만 기록한다. */
function isOpenable(path: string): boolean {
  const extension = path
    .slice(path.lastIndexOf(EXTENSION_SEPARATOR) + 1)
    .toLowerCase();
  return OPENABLE_EXTENSIONS.some((openable) => openable === extension);
}

function reject(code: string, path: string): PlatformError {
  return new PlatformError({ code, message: path });
}

/**
 * 메모리 안 가짜 파일로 동작하는 구현(브라우저 E2E용).
 * 허용 경로 규칙과 에러 코드는 Tauri 커맨드와 같다.
 */
export function createMockPlatform({
  files = []
}: MockPlatformOptions = {}): MockPlatform {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const pickedPaths = new Set<string>();
  const dropHandlers = new Set<FileDropHandler>();
  const saveTargets = new Set<string>();
  const tempOutputs = new Set<string>();

  const ensureReadable = (path: string): void => {
    if (!pickedPaths.has(path) && !tempOutputs.has(path)) {
      throw reject(MOCK_ERROR_CODE.PATH_NOT_ALLOWED, path);
    }
  };

  const ensureTemp = (path: string): void => {
    if (!tempOutputs.has(path)) {
      throw reject(MOCK_ERROR_CODE.PATH_NOT_ALLOWED, path);
    }
  };

  const ensureSaveTarget = (path: string): void => {
    if (!saveTargets.has(path)) {
      throw reject(MOCK_ERROR_CODE.PATH_NOT_ALLOWED, path);
    }
  };

  const openFile = (path: string): OpenedFile => {
    const file = filesByPath.get(path);
    if (!pickedPaths.has(path) || !file) {
      const code = file
        ? MOCK_ERROR_CODE.PATH_NOT_ALLOWED
        : MOCK_ERROR_CODE.NOT_FOUND;
      return {
        status: "error",
        sourcePath: path,
        error: { code, message: path }
      };
    }
    return {
      status: "ok",
      sourcePath: path,
      pdfPath: path,
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
      saveTargets.add(path);
      return path;
    },
    openFiles: async (paths) => paths.map(openFile),
    readPdf: async (path) => {
      ensureReadable(path);
      const bytes = filesByPath.get(path)?.bytes;
      if (!bytes) {
        throw reject(MOCK_ERROR_CODE.NOT_FOUND, path);
      }
      return bytes.slice();
    },
    mergePdfs: async ({ request, onProgress }) => {
      for (const source of request.sources) {
        ensureReadable(source.path);
      }
      const { output } = request;
      let outputPath: string;
      if (output.kind === MERGE_OUTPUT_KIND.TEMP) {
        outputPath = `${MOCK_DIRECTORY.TEMP}/merged-${request.jobId}.pdf`;
        tempOutputs.add(outputPath);
      } else {
        ensureSaveTarget(output.path);
        outputPath = output.path;
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
      return { outputPath, pageCount };
    },
    cancelJob: async () => {},
    copyFile: async ({ source, destination }) => {
      ensureTemp(source);
      ensureSaveTarget(destination);
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
