export {
  FILE_DROP_EVENT_TYPE,
  LOG_LEVEL,
  MERGE_OUTPUT_KIND,
  type AppUpdate,
  type ClientPoint,
  type ComparePdfsParams,
  type CompareProgressHandler,
  type CopyFileParams,
  type DesktopPlatform,
  type FileDropDropEvent,
  type FileDropEvent,
  type FileDropHandler,
  type LogLevel,
  type LogParams,
  type MergePdfsParams,
  type MergeProgressHandler,
  type PickSaveDirectoryOptions,
  type PickSavePathOptions,
  type SetSettingParams,
  type SettingValue,
  type Unsubscribe,
  type UpdateDownloadProgress,
  type UpdateDownloadProgressHandler
} from "./desktop-platform";
export { getPlatform, setPlatform } from "./current-platform";
export { hasRunningWork, trackRunningWork } from "./running-work";
export {
  PLATFORM_ERROR_CODE,
  type PlatformErrorCode,
  PlatformError,
  toPlatformError
} from "./platform-error";
export { createTauriPlatform, isTauriRuntime } from "./tauri-platform";
export {
  createMockPlatform,
  type MockMergeOutput,
  type MockPdfFile,
  type MockPlatform,
  type MockPlatformOptions,
  type MockUpdate
} from "./mock-platform";
export type { NativeFileDropEvent } from "./native-file-drop";
