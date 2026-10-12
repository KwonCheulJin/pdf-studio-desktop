import { Channel, isTauri } from "@tauri-apps/api/core";
import { documentDir, join } from "@tauri-apps/api/path";
import {
  error as writeErrorLog,
  info as writeInfoLog,
  warn as writeWarnLog
} from "@tauri-apps/plugin-log";
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

/** Tauri 웹뷰는 초기화 스크립트로 `isTauri` 전역을 넣는다. 브라우저·테스트에서는 false */
export function isTauriRuntime(): boolean {
  return isTauri();
}

export function createTauriPlatform(): DesktopPlatform {
  return {
    pickFiles: () => unwrap(commands.pickFiles()),
    pickSavePath: async ({ fileName }) => {
      const defaultPath = await settle(
        documentDir().then((directory) => join(directory, fileName))
      );
      return unwrap(commands.pickSavePath({ defaultPath }));
    },
    openFiles: (paths) => unwrap(commands.openFiles(paths)),
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
    }
  };
}
