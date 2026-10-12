export {
  FILE_DROP_EVENT_TYPE,
  LOG_LEVEL,
  MERGE_OUTPUT_KIND,
  type ClientPoint,
  type CopyFileParams,
  type DesktopPlatform,
  type FileDropDropEvent,
  type FileDropEvent,
  type FileDropHandler,
  type LogLevel,
  type LogParams,
  type MergePdfsParams,
  type MergeProgressHandler,
  type PickSavePathOptions,
  type SetSettingParams,
  type SettingValue,
  type Unsubscribe
} from "./desktop-platform";
export { getPlatform, setPlatform } from "./current-platform";
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
  type MockPlatformOptions
} from "./mock-platform";
export type { NativeFileDropEvent } from "./native-file-drop";
