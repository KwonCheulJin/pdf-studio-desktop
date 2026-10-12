export {
  LOG_LEVEL,
  MERGE_OUTPUT_KIND,
  type CopyFileParams,
  type DesktopPlatform,
  type LogLevel,
  type LogParams,
  type MergePdfsParams,
  type MergeProgressHandler,
  type PickSavePathOptions
} from "./desktop-platform";
export { getPlatform, setPlatform } from "./current-platform";
export { PLATFORM_ERROR_CODE, PlatformError } from "./platform-error";
export { createTauriPlatform, isTauriRuntime } from "./tauri-platform";
export {
  createMockPlatform,
  type MockPdfFile,
  type MockPlatformOptions
} from "./mock-platform";
