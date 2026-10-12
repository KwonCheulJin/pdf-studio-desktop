import { Channel, isTauri } from "@tauri-apps/api/core";
import { basename, documentDir, extname, join } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  error as writeErrorLog,
  info as writeInfoLog,
  warn as writeWarnLog
} from "@tauri-apps/plugin-log";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  commands,
  type AppError,
  type MergeProgress
} from "@/renderer/shared/api/bindings";
import {
  LOG_LEVEL,
  type DesktopPlatform,
  type LogLevel
} from "./desktop-platform";
import { toFileDropEvent } from "./native-file-drop";
import { toPlatformError } from "./platform-error";

interface CommandSuccess<T> {
  status: "ok";
  data: T;
}

interface CommandFailure {
  status: "error";
  error: AppError;
}

type CommandResult<T> = CommandSuccess<T> | CommandFailure;

type LogWriter = (message: string) => Promise<void>;

/** 확장자 앞 구분자. `extname`은 구분자 없이 돌려준다. */
const EXTENSION_SEPARATOR = ".";

/** 앱 설정 파일(앱 데이터 폴더 안). `plugin-store`가 JSON으로 저장한다. */
const SETTINGS_FILE = "settings.json";

/** WebView2 사용자 에이전트에 들어 있는 OS 이름 */
const WINDOWS_USER_AGENT_TOKEN = "Windows";

const LOG_WRITERS: Record<LogLevel, LogWriter> = {
  [LOG_LEVEL.INFO]: writeInfoLog,
  [LOG_LEVEL.WARN]: writeWarnLog,
  [LOG_LEVEL.ERROR]: writeErrorLog
};

async function settle<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw toPlatformError(error);
  }
}

async function unwrap<T>(command: Promise<CommandResult<T>>): Promise<T> {
  const result = await settle(command);
  if (result.status === "error") {
    throw toPlatformError(result.error);
  }
  return result.data;
}

/** 확장자가 없으면 `extname`이 실패하므로 `null` */
async function extensionOf(path: string): Promise<string | null> {
  try {
    return await extname(path);
  } catch {
    return null;
  }
}

async function fileStemOf(path: string): Promise<string> {
  const extension = await extensionOf(path);
  try {
    return await basename(
      path,
      extension === null ? undefined : `${EXTENSION_SEPARATOR}${extension}`
    );
  } catch {
    // 마지막 이름이 없는 경로(루트 등)는 경로 그대로 보인다.
    return path;
  }
}

/**
 * 드롭 좌표 1 CSS 픽셀에 해당하는 좌표 단위 수. 타입은 `PhysicalPosition`이지만
 * 실제 단위는 웹뷰마다 다르다(wry 0.57): WebView2(Windows)는 클라이언트 영역 물리 픽셀,
 * WKWebView(macOS)·WebKitGTK(Linux)는 이미 논리(CSS) 픽셀이다.
 */
function dropPositionPixelRatio(): number {
  return navigator.userAgent.includes(WINDOWS_USER_AGENT_TOKEN)
    ? window.devicePixelRatio
    : 1;
}

/** Tauri 웹뷰는 초기화 스크립트로 `isTauri` 전역을 넣는다. 브라우저·테스트에서는 false */
export function isTauriRuntime(): boolean {
  return isTauri();
}

export function createTauriPlatform(): DesktopPlatform {
  const settings = new LazyStore(SETTINGS_FILE);
  return {
    pickFiles: () => unwrap(commands.pickFiles()),
    pickSavePath: async ({ fileName }) => {
      const defaultPath = await settle(
        documentDir().then((directory) => join(directory, fileName))
      );
      return unwrap(commands.pickSavePath({ defaultPath }));
    },
    openFiles: (paths) => unwrap(commands.openFiles(paths)),
    fileStem: fileStemOf,
    readPdf: async (path) =>
      new Uint8Array(await unwrap(commands.readPdf(path))),
    mergePdfs: ({ request, onProgress }) => {
      const channel = new Channel<MergeProgress>();
      if (onProgress) {
        channel.onmessage = onProgress;
      }
      return unwrap(commands.mergePdfs(request, channel));
    },
    cancelJob: (jobId) => settle(commands.cancelJob(jobId)),
    copyFile: async ({ source, destination }) => {
      await unwrap(commands.copyFile(source, destination));
    },
    discardTemp: async (path) => {
      await unwrap(commands.discardTemp(path));
    },
    log: ({ level, message }) => {
      LOG_WRITERS[level](message).catch((error: unknown) => {
        console.error(`로그 기록 실패: ${String(error)}`, message);
      });
    },
    onFileDrop: (handler) => {
      const listening = getCurrentWebview().onDragDropEvent(({ payload }) => {
        handler(
          toFileDropEvent({
            event: payload,
            pixelRatio: dropPositionPixelRatio()
          })
        );
      });
      listening.catch((error: unknown) => {
        console.error(`파일 드롭 구독 실패: ${String(error)}`);
      });
      return () => {
        listening
          .then((stopListening) => stopListening())
          .catch(() => {
            // 구독이 실패했으면 끊을 것이 없다(위에서 기록함).
          });
      };
    },
    getSetting: (key) => settle(settings.get<unknown>(key)),
    setSetting: async ({ key, value }) => {
      await settle(settings.set(key, value));
      await settle(settings.save());
    },
    readThirdPartyNotices: () => unwrap(commands.readThirdPartyNotices())
  };
}
