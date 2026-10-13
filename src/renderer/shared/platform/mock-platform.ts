import {
  API_KEY_MAX_LEN,
  API_KEY_PREFIX,
  OPENABLE_EXTENSIONS,
  type ApiKeyStatus,
  type AppError,
  type DetectedLanguage,
  type CompareProgress,
  type CompareReportOptions,
  type CompareResult,
  type ErrorCode,
  type ExportedFile,
  type ExportOutput,
  type MergeResult,
  type OpenedFile,
  type PageInfo,
  type PageSize,
  type Placement,
  type ReportLayout,
  type PageKind,
  type ParagraphStatus,
  type SourceLanguage,
  type TextSource,
  type TranslatedPage,
  type TranslatedParagraph,
  type TranslateOptions,
  type TranslationPlan,
  type TranslationResult
} from "@/renderer/shared/api/bindings";
import { parsePageRange } from "@/renderer/shared/lib/page-range-parse";
import {
  FILE_DROP_EVENT_TYPE,
  MERGE_OUTPUT_KIND,
  type AppUpdate,
  type DesktopPlatform,
  type FileDropHandler,
  type SettingValue
} from "./desktop-platform";
import { toFileDropEvent, type NativeFileDropEvent } from "./native-file-drop";
import { PLATFORM_ERROR_CODE, PlatformError } from "./platform-error";

/** 가짜 파일 하나. `bytes`가 없으면 `readPdf`가 `NOT_FOUND`로 실패한다. */
export interface MockPdfFile {
  path: string;
  displayName: string;
  /** `openFiles`가 돌려줄 쪽별 크기·원본 회전. 쪽 수는 이 길이다. */
  pages: PageInfo[];
  title?: string;
  bytes?: Uint8Array;
  /** `openFiles`가 돌려줄 파일 크기(바이트). 없으면 `bytes` 길이, 그것도 없으면 0 */
  sizeBytes?: number;
  /**
   * TIFF처럼 열 때 PDF로 변환되는 파일이면 `openFiles`가 `pdfPath`로 돌려줄 변환 결과 경로.
   * Rust의 앱 캐시 폴더처럼 고르지 않아도 읽을 수 있고, 바이트는 `bytes`를 쓴다.
   */
  convertedPath?: string;
}

/** 업데이트 서버가 알릴 새 버전과 받을 때 보낼 진행률 */
export interface MockUpdate {
  version: string;
  /** 서버가 알려 준 전체 크기. `null`이면 크기를 모를 때다. */
  totalBytes: number | null;
  /** 받을 때 차례로 보낼 조각 크기(바이트). 진행률은 누계로 보낸다. */
  chunkBytes: number[];
}

/** 병합 결과를 쓸 임시 경로와 그 파일 이름(`MergeResult`의 같은 필드) */
export type MockMergeOutput = Pick<MergeResult, "outputPath" | "fileName">;

export interface MockPlatformOptions {
  /** 열기 다이얼로그가 고르는 파일들. 드롭으로도 열 수 있다. */
  files?: MockPdfFile[];
  /**
   * 열기 다이얼로그를 열 때마다 앞에서부터 하나씩 쓰는, 그때 고를 경로 목록(빈 목록은 취소).
   * 다 쓰면(또는 없으면) `files`를 모두 고른다.
   */
  dialogPicks?: string[][];
  /** 있으면 `temp` 출력 병합이 이 경로에 쓴다. 없으면 작업 ID로 이름을 만든다. */
  mergeOutput?: MockMergeOutput;
  /** `readThirdPartyNotices`가 돌려줄 고지 원문. 없으면 번들에 파일이 없을 때처럼 실패한다. */
  thirdPartyNotices?: string;
  /**
   * 폴더 다이얼로그(`pickSaveDirectory`)를 열 때마다 앞에서부터 하나씩 고를 폴더(`null`은 취소).
   * 다 쓰면(또는 없으면) `/mock/exports`를 고른다.
   */
  directoryPicks?: (string | null)[];
  /** 있으면 `checkForUpdate`가 이 새 버전을 알린다. 없으면 최신 버전일 때처럼 `null` */
  update?: MockUpdate;
  /** 시작할 때의 API 키 상태. 없으면 등록되지 않았다. 등록됐으면 키체인에 키가 있는 것으로 본다. */
  apiKey?: ApiKeyStatus;
  /** 시작할 때 저장돼 있는 번역 기록의 ID들(내용은 비어 있다). 저장된 번역 수를 보이는 데 쓴다. */
  savedRecordIds?: string[];
}

export interface MockPlatform extends DesktopPlatform {
  /**
   * 창 밖 파일 드래그·드롭을 흉내 낸다. 좌표는 WebView2처럼 물리 픽셀로 받아
   * `devicePixelRatio`로 나눈다. 드롭한 경로는 구독자에게 알리기 전에
   * 허용 목록에 기록한다(Rust가 드롭 이벤트에서 기록하는 것과 같은 순서).
   */
  simulateFileDrop(event: NativeFileDropEvent): void;
  /**
   * 번역 결과를 기억한다(Rust 이어하기 기록 대신). 다시 번역·직접 고치기는 기억한 결과의 문단만 찾는다.
   * `translatePdf`가 만든 결과는 저절로 기억하고, 시드 결과는 E2E 플랫폼이 이것으로 알린다.
   */
  rememberTranslation(result: TranslationResult): void;
}

/** Rust 커맨드가 같은 상황에서 돌려주는 코드 */
const MOCK_ERROR_CODE = {
  NOT_FOUND: "NOT_FOUND",
  PATH_NOT_ALLOWED: "PATH_NOT_ALLOWED",
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  RESOURCE_UNAVAILABLE: "RESOURCE_UNAVAILABLE",
  INVALID_RANGE: "INVALID_RANGE",
  EMPTY_REPORT: "EMPTY_REPORT",
  WRITE_FAILED: "WRITE_FAILED",
  API_KEY_INVALID: "API_KEY_INVALID",
  API_KEY_MISSING: "API_KEY_MISSING",
  TRANSLATION_MISMATCH: "TRANSLATION_MISMATCH",
  TRANSLATION_RECORD_NOT_FOUND: "TRANSLATION_RECORD_NOT_FOUND"
} as const satisfies Record<string, ErrorCode>;

/** 변경 쪽에 글자 상자가 있음(`Placement.kind`). 앵커는 상자가 없다. */
const MOCK_PLACEMENT_BOXES = "boxes" satisfies Placement["kind"];

/** 비교 PDF 배치(`ReportLayout`) */
const MOCK_REPORT_LAYOUT = {
  A_ONLY: "aOnly",
  B_ONLY: "bOnly"
} as const satisfies Record<string, ReportLayout>;

/**
 * mock 리포트. 장 수는 Rust `report::PREVIEW_SHEETS`, 이름 번호는 Rust `access::export_target`과 같고,
 * 장 그림은 A4 가로(841.89 × 595.28pt) 비율의 흰 종이에 장 번호를 쓴 PNG다.
 */
const MOCK_REPORT = {
  PREVIEW_SHEETS: 8,
  FIRST_DUPLICATE_NUMBER: 2,
  MAX_DUPLICATE_NUMBER: 999,
  SHEET_ASPECT_RATIO: 841.89 / 595.28,
  PNG_DATA_URL_PREFIX: "data:image/png;base64,",
  PAPER_COLOR: "#ffffff",
  INK_COLOR: "#3f3f46",
  FONT: "600 48px sans-serif"
} as const;

const PATH_SEPARATORS = ["/", "\\"] as const;
const PARENT_DIRECTORY = "..";

/** mock 비교의 마지막 단계와 결과 글자 출처(Rust와 같은 값) */
const MOCK_COMPARE = {
  LAST_STAGE: "alignPages",
  TEXT_SOURCE: "textLayer"
} as const satisfies {
  LAST_STAGE: CompareProgress["stage"];
  TEXT_SOURCE: TextSource;
};

const MOCK_DIRECTORY = {
  TEMP: "/mock/temp",
  SAVE: "/mock/saved",
  EXPORTS: "/mock/exports"
} as const;

const PERCENT_COMPLETE = 100;

/**
 * mock 번역. 글을 모르므로 범위 쪽은 문단 없는 글자층 쪽이고(언어·번역할 것 검사는 하지 않는다, 결과는 시드가
 * 준다) 언어는 고른 언어(자동 감지면 중국어)다. 키 힌트 길이는 Rust `ApiKey::hint`와 같다.
 */
const MOCK_TRANSLATION = {
  KEY_HINT_LENGTH: 4,
  RECORD_ID_PREFIX: "mock-record-",
  PRICING_DATE: "2026-10-13",
  TRANSFER_CONFIRMED_ONCE_SETTING: "translate.transferConfirmedOnce"
} as const;

/** mock 번역 결과의 쪽 종류·문단 상태·언어(Rust 계약 값) */
const MOCK_PAGE_KIND = {
  TEXT_LAYER: "textLayer",
  OUT_OF_RANGE: "outOfRange"
} as const satisfies Record<string, PageKind>;

const MOCK_PARAGRAPH_STATUS = {
  TRANSLATED: "translated",
  EDITED: "edited",
  FAILED: "failed"
} as const satisfies Record<string, ParagraphStatus>;

const MOCK_LANGUAGE = {
  ZH: "zh",
  EN: "en",
  UNKNOWN: "unknown"
} as const satisfies Record<string, DetectedLanguage>;

const SOURCE_LANGUAGE_EN = "en" satisfies SourceLanguage;

/** 키에 쓸 수 있는 글자: ASCII 그래픽 글자(공백·제어 문자 없음, Rust `ApiKey::parse`) */
const API_KEY_CHARACTERS = /^[\x21-\x7E]+$/;

const NO_TOKENS = { inputTokens: 0, outputTokens: 0 } as const;

/** Rust `ApiKey::parse`처럼 앞뒤 공백을 지운 키가 형식에 맞는지 */
function isWellFormedKey(key: string): boolean {
  const trimmed = key.trim();
  return (
    trimmed.startsWith(API_KEY_PREFIX) &&
    trimmed.length <= API_KEY_MAX_LEN &&
    API_KEY_CHARACTERS.test(trimmed)
  );
}

function invalidKey(): PlatformError {
  return new PlatformError({
    code: MOCK_ERROR_CODE.API_KEY_INVALID,
    message: "API key format is invalid",
    path: null
  });
}

function recordNotFound(): PlatformError {
  return new PlatformError({
    code: MOCK_ERROR_CODE.TRANSLATION_RECORD_NOT_FOUND,
    message: "translation record or paragraph was not found",
    path: null
  });
}

interface MockTranslationParams {
  jobId: string;
  path: string;
  options: TranslateOptions;
  file: MockPdfFile;
  /** 범위(0부터) */
  range: number[];
}

/** 시드가 없을 때의 결과: 범위 쪽은 문단 없는 글자층 쪽, 범위 밖은 `outOfRange`(Rust와 같은 쪽 배열) */
function emptyTranslationResult({
  jobId,
  path,
  options,
  file,
  range
}: MockTranslationParams): TranslationResult {
  const pages = file.pages.map(
    (_, page): TranslatedPage => ({
      page,
      kind: range.includes(page)
        ? MOCK_PAGE_KIND.TEXT_LAYER
        : MOCK_PAGE_KIND.OUT_OF_RANGE,
      paragraphs: [],
      failCode: null
    })
  );
  return {
    recordId: `${MOCK_TRANSLATION.RECORD_ID_PREFIX}${jobId}`,
    path,
    language:
      options.sourceLanguage === SOURCE_LANGUAGE_EN
        ? MOCK_LANGUAGE.EN
        : MOCK_LANGUAGE.ZH,
    model: options.model,
    pages,
    usage: NO_TOKENS,
    elapsedMs: 0,
    glossaryUsed: []
  };
}

/** 기억한 결과의 문단 하나와 처음 받은 번역(직접 고친 글을 지우면 돌아갈 글) */
interface RememberedParagraph {
  paragraph: TranslatedParagraph;
  translated: string | null;
}

/** Rust `notices::THIRD_PARTY_NOTICES_FILE`(실패 메시지용) */
const THIRD_PARTY_NOTICES_FILE = "THIRD_PARTY_NOTICES.md";

const EXTENSION_SEPARATOR = ".";
const PDF_EXTENSION = "pdf";
const MERGED_FILE_PREFIX = "merged-";

/** 받기 전에 설치하면 업데이터 플러그인처럼 실패한다. */
function createMockUpdate({
  version,
  totalBytes,
  chunkBytes
}: MockUpdate): AppUpdate {
  let isDownloaded = false;
  return {
    version,
    download: async (onProgress) => {
      let downloadedBytes = 0;
      for (const chunk of chunkBytes) {
        downloadedBytes += chunk;
        onProgress({ downloadedBytes, totalBytes });
      }
      isDownloaded = true;
    },
    installAndRestart: async () => {
      if (!isDownloaded) {
        throw new PlatformError({
          code: PLATFORM_ERROR_CODE.IPC_FAILED,
          message: `update ${version} was not downloaded`,
          path: null
        });
      }
    }
  };
}

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

/** pdf.js `page.view`처럼 보이는 영역은 CropBox로 둔다(시드 PDF는 MediaBox 안의 CropBox만 쓴다). */
function pageSizeOf(page: PageInfo): PageSize {
  return { viewBox: page.cropBox, rotation: page.rotation };
}

interface MockCompareSide {
  file: MockPdfFile;
  /** 비교 범위(0부터) */
  range: number[];
}

/** 문서의 모든 쪽 출처. 범위 밖은 `null`(Rust와 같다) */
function pageSourcesOf({
  file,
  range
}: MockCompareSide): (TextSource | null)[] {
  return file.pages.map((_, page) =>
    range.includes(page) ? MOCK_COMPARE.TEXT_SOURCE : null
  );
}

interface CompareSideParams {
  path: string;
  /** 사용자 쪽 범위 문자열(비우면 전체) */
  range: string;
}

interface MockCompareResultParams {
  before: MockCompareSide;
  after: MockCompareSide;
}

/**
 * 차이 없는 결과: 두 범위를 차례로 짝짓고 남는 쪽은 A만 있는 행 → B만 있는 행으로 둔다.
 * 실제 변경·안내가 필요한 테스트는 시드(`compareScripts`)로 결과를 준다.
 */
function emptyCompareResult({
  before,
  after
}: MockCompareResultParams): CompareResult {
  const paired = Math.min(before.range.length, after.range.length);
  const pagePairs: CompareResult["pagePairs"] = [
    ...before.range
      .slice(0, paired)
      .map((page, index): [number, number] => [page, after.range[index]]),
    ...before.range.slice(paired).map((page): [number, null] => [page, null]),
    ...after.range.slice(paired).map((page): [null, number] => [null, page])
  ];
  return {
    changes: [],
    pagePairs,
    pageSizes: {
      before: before.file.pages.map(pageSizeOf),
      after: after.file.pages.map(pageSizeOf)
    },
    pageSources: {
      before: pageSourcesOf(before),
      after: pageSourcesOf(after)
    },
    notices: []
  };
}

type ReportRow = CompareResult["pagePairs"][number];

interface MockReportSheetsParams {
  result: CompareResult;
  options: CompareReportOptions;
}

/**
 * Rust `plan_sheets`(ADR 0001 §14)처럼 장을 고른다: 행 순서, 한쪽 배치는 그쪽 쪽이 없는 행을 빼고,
 * 차이 쪽만이면 장에 보이는 쪽에 숨기지 않은 변경 상자가 있는 행만 남긴다.
 */
function mockReportSheets({
  result,
  options
}: MockReportSheetsParams): ReportRow[] {
  const visible = result.changes.filter(
    (change) => !options.hiddenKinds.includes(change.kind)
  );
  const hasBox = (side: "before" | "after", page: number | null): boolean =>
    page !== null &&
    visible.some((change) => {
      const placement = change[side];
      return (
        placement.kind === MOCK_PLACEMENT_BOXES &&
        placement.boxes.some((bounds) => bounds.page === page)
      );
    });
  return result.pagePairs
    .map(([before, after]): ReportRow => {
      if (options.layout === MOCK_REPORT_LAYOUT.A_ONLY) return [before, null];
      if (options.layout === MOCK_REPORT_LAYOUT.B_ONLY) return [null, after];
      return [before, after];
    })
    .filter(([before, after]) => before !== null || after !== null)
    .filter(
      ([before, after]) =>
        !options.changedPagesOnly ||
        hasBox("before", before) ||
        hasBox("after", after)
    );
}

interface MockSheetImageParams {
  sheetNumber: number;
  widthPx: number;
}

/** 장 번호를 쓴 종이 PNG(base64). 장마다 그림이 달라 넘기기를 확인할 수 있다. */
function mockSheetImage({
  sheetNumber,
  widthPx
}: MockSheetImageParams): string {
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = Math.round(widthPx / MOCK_REPORT.SHEET_ASPECT_RATIO);
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = MOCK_REPORT.PAPER_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = MOCK_REPORT.INK_COLOR;
    context.font = MOCK_REPORT.FONT;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(sheetNumber), canvas.width / 2, canvas.height / 2);
  }
  return canvas
    .toDataURL("image/png")
    .slice(MOCK_REPORT.PNG_DATA_URL_PREFIX.length);
}

/** Rust `export_target`처럼 경로 구분자·`..` 없는 이름 하나만 받는다. */
function isPlainName(fileName: string): boolean {
  return (
    fileName !== "" &&
    fileName !== PARENT_DIRECTORY &&
    PATH_SEPARATORS.every((separator) => !fileName.includes(separator))
  );
}

/**
 * 메모리 안 가짜 파일로 동작하는 구현(브라우저 E2E용).
 * 허용 경로 규칙과 에러 코드는 Tauri 커맨드와 같다.
 */
export function createMockPlatform({
  files = [],
  dialogPicks = [],
  mergeOutput,
  thirdPartyNotices,
  directoryPicks = [],
  update,
  apiKey,
  savedRecordIds = []
}: MockPlatformOptions = {}): MockPlatform {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const convertedFiles = new Map(
    files.flatMap((file) =>
      file.convertedPath ? [[file.convertedPath, file] as const] : []
    )
  );
  const pendingDialogPicks = [...dialogPicks];
  const pickedPaths = new Set<string>();
  const dropHandlers = new Set<FileDropHandler>();
  /** 저장 다이얼로그에서 고른 경로 → 그 파일 이름 */
  const saveTargets = new Map<string, string>();
  const tempOutputs = new Set<string>();
  const settings = new Map<string, SettingValue>();
  const pendingDirectoryPicks = [...directoryPicks];
  /** 폴더 다이얼로그에서 고른 내보내기 폴더 */
  const saveDirectories = new Set<string>();
  /** 내보낸 파일 경로(같은 이름이면 Rust처럼 번호를 붙인다) */
  const exportedPaths = new Set<string>();
  let apiKeyStatus: ApiKeyStatus = apiKey ?? { registered: false, hint: null };
  /** 기록 키 → 문단 키 → 기억한 문단(Rust 이어하기 기록 대신) */
  const translations = new Map<string, Map<string, RememberedParagraph>>(
    savedRecordIds.map((recordId) => [recordId, new Map()])
  );

  const rememberTranslation = (result: TranslationResult): void => {
    const paragraphs = new Map(
      result.pages
        .flatMap((page) => page.paragraphs)
        .map((paragraph): [string, RememberedParagraph] => [
          paragraph.key,
          {
            paragraph,
            translated:
              paragraph.status === MOCK_PARAGRAPH_STATUS.TRANSLATED
                ? paragraph.target
                : null
          }
        ])
    );
    translations.set(result.recordId, paragraphs);
  };

  const findParagraph = (
    recordId: string,
    key: string
  ): RememberedParagraph => {
    const remembered = translations.get(recordId)?.get(key);
    if (!remembered) {
      throw recordNotFound();
    }
    return remembered;
  };

  const ensureKeyRegistered = (): void => {
    if (!apiKeyStatus.registered) {
      throw new PlatformError({
        code: MOCK_ERROR_CODE.API_KEY_MISSING,
        message: "API key is not in the keychain",
        path: null
      });
    }
  };

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

  /** Rust `merge`·`compare`처럼 입력은 허용 목록 안의 PDF만 받는다. */
  const ensureMergeSource = (path: string): void => {
    ensureReadable(path);
    if (extensionOf(path) !== PDF_EXTENSION) {
      throw new PlatformError(
        rejectedPath({ code: MOCK_ERROR_CODE.UNSUPPORTED_FILE_TYPE, path })
      );
    }
  };

  /** Rust `compare_pdfs`처럼 파일을 연 뒤 쪽 범위를 검사한다. 범위 오류는 경로가 없다. */
  const openCompareSide = ({
    path,
    range
  }: CompareSideParams): MockCompareSide => {
    ensureMergeSource(path);
    const file = filesByPath.get(path) ?? convertedFiles.get(path);
    if (!file) {
      throw new PlatformError(missingFile(path));
    }
    const parsed = parsePageRange({
      input: range,
      pageCount: file.pages.length
    });
    if (!parsed.isValid) {
      throw new PlatformError({
        code: MOCK_ERROR_CODE.INVALID_RANGE,
        message: range,
        path: null
      });
    }
    return { file, range: parsed.pages };
  };

  /** Rust `export_target`: 고른 폴더 바로 안의 새 이름. 같은 이름이 있으면 `이름 (2).pdf`… */
  const exportTarget = ({
    directory,
    fileName
  }: ExportOutput): ExportedFile => {
    const target = `${directory}/${fileName}`;
    if (!saveDirectories.has(directory) || !isPlainName(fileName)) {
      throw new PlatformError(
        rejectedPath({ code: MOCK_ERROR_CODE.PATH_NOT_ALLOWED, path: target })
      );
    }
    if (extensionOf(fileName) !== PDF_EXTENSION) {
      throw new PlatformError(
        rejectedPath({
          code: MOCK_ERROR_CODE.UNSUPPORTED_FILE_TYPE,
          path: target
        })
      );
    }
    const stem = stemOf(fileName);
    const extension = fileName.slice(stem.length);
    const numbers = Array.from(
      {
        length:
          MOCK_REPORT.MAX_DUPLICATE_NUMBER -
          MOCK_REPORT.FIRST_DUPLICATE_NUMBER +
          1
      },
      (_, offset) => MOCK_REPORT.FIRST_DUPLICATE_NUMBER + offset
    );
    const name = [
      fileName,
      ...numbers.map((number) => `${stem} (${number})${extension}`)
    ].find((candidate) => !exportedPaths.has(`${directory}/${candidate}`));
    if (name === undefined) {
      throw new PlatformError({
        code: MOCK_ERROR_CODE.WRITE_FAILED,
        message: target,
        path: null
      });
    }
    const outputPath = `${directory}/${name}`;
    exportedPaths.add(outputPath);
    return { outputPath, fileName: name };
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
      sizeBytes: file.sizeBytes ?? file.bytes?.length ?? 0,
      info: {
        pageCount: file.pages.length,
        title: file.title ?? null,
        pages: file.pages
      }
    };
  };

  return {
    pickFiles: async () => {
      const picked =
        pendingDialogPicks.shift() ?? files.map((file) => file.path);
      for (const path of picked) {
        pickedPaths.add(path);
      }
      return picked;
    },
    pickSavePath: async ({ fileName }) => {
      const path = `${MOCK_DIRECTORY.SAVE}/${fileName}`;
      saveTargets.set(path, fileName);
      return path;
    },
    pickSaveDirectory: async () => {
      const picked = pendingDirectoryPicks.length
        ? (pendingDirectoryPicks.shift() ?? null)
        : MOCK_DIRECTORY.EXPORTS;
      if (picked !== null) {
        saveDirectories.add(picked);
      }
      return picked;
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
    comparePdfs: async ({ request, onProgress }) => {
      const before = openCompareSide({
        path: request.before,
        range: request.options.rangeA
      });
      const after = openCompareSide({
        path: request.after,
        range: request.options.rangeB
      });
      const rangeTotal = before.range.length + after.range.length;
      onProgress?.({
        jobId: request.jobId,
        stage: MOCK_COMPARE.LAST_STAGE,
        done: rangeTotal,
        total: rangeTotal,
        stagePercent: PERCENT_COMPLETE,
        overallPercent: PERCENT_COMPLETE,
        detail: null
      });
      return emptyCompareResult({ before, after });
    },
    previewCompareReport: async ({
      result,
      before,
      after,
      options,
      widthPx
    }) => {
      ensureMergeSource(before);
      ensureMergeSource(after);
      const sheets = mockReportSheets({ result, options });
      if (sheets.length === 0) {
        throw new PlatformError({
          code: MOCK_ERROR_CODE.EMPTY_REPORT,
          message: "no sheets",
          path: null
        });
      }
      return {
        sheetCount: sheets.length,
        images: sheets
          .slice(0, MOCK_REPORT.PREVIEW_SHEETS)
          .map((_, index) =>
            mockSheetImage({ sheetNumber: index + 1, widthPx })
          )
      };
    },
    exportComparePdf: async ({ result, before, after, options, output }) => {
      ensureMergeSource(before);
      ensureMergeSource(after);
      if (mockReportSheets({ result, options }).length === 0) {
        throw new PlatformError({
          code: MOCK_ERROR_CODE.EMPTY_REPORT,
          message: "no sheets",
          path: null
        });
      }
      return exportTarget(output);
    },
    exportAnnotatedPdf: async ({ after, output }) => {
      ensureMergeSource(after);
      return exportTarget(output);
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
    checkForUpdate: async () =>
      update === undefined ? null : createMockUpdate(update),
    getApiKeyStatus: async () => apiKeyStatus,
    verifyApiKey: async (key) => {
      if (!isWellFormedKey(key)) {
        throw invalidKey();
      }
    },
    saveApiKey: async (key) => {
      if (!isWellFormedKey(key)) {
        throw invalidKey();
      }
      apiKeyStatus = {
        registered: true,
        hint: key.trim().slice(-MOCK_TRANSLATION.KEY_HINT_LENGTH)
      };
      settings.set(MOCK_TRANSLATION.TRANSFER_CONFIRMED_ONCE_SETTING, false);
      return apiKeyStatus;
    },
    deleteApiKey: async () => {
      apiKeyStatus = { registered: false, hint: null };
      return apiKeyStatus;
    },
    // Rust처럼 파일을 연 뒤 쪽 범위를 검사한다. 글을 모르므로 문단·예상치는 0이고 언어는 모름이다.
    prepareTranslation: async ({ path, options }): Promise<TranslationPlan> => {
      const { file, range } = openCompareSide({ path, range: options.range });
      return {
        pageCount: file.pages.length,
        textPages: file.pages.length,
        scanPages: 0,
        rangePages: range.length,
        detectedLanguage: MOCK_LANGUAGE.UNKNOWN,
        paragraphCount: 0,
        chunkCount: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedCostMicroUsd: 0,
        pricingDate: MOCK_TRANSLATION.PRICING_DATE,
        resumable: null
      };
    },
    translatePdf: async ({ request }) => {
      const { file, range } = openCompareSide({
        path: request.path,
        range: request.options.range
      });
      ensureKeyRegistered();
      const result = emptyTranslationResult({
        jobId: request.jobId,
        path: request.path,
        options: request.options,
        file,
        range
      });
      rememberTranslation(result);
      return result;
    },
    retranslateParagraph: async (request) => {
      ensureMergeSource(request.path);
      const { paragraph } = findParagraph(request.recordId, request.key);
      ensureKeyRegistered();
      return { paragraph, usage: NO_TOKENS };
    },
    // Rust처럼 앞뒤 공백을 지워 고친 글로 두고, 빈 글이면 처음 번역(없으면 실패)으로 돌린다.
    editTranslatedParagraph: async (request) => {
      ensureMergeSource(request.path);
      const remembered = findParagraph(request.recordId, request.key);
      const text = request.text.trim();
      const edited: TranslatedParagraph =
        text === ""
          ? {
              ...remembered.paragraph,
              target: remembered.translated,
              status:
                remembered.translated === null
                  ? MOCK_PARAGRAPH_STATUS.FAILED
                  : MOCK_PARAGRAPH_STATUS.TRANSLATED,
              failCode:
                remembered.translated === null
                  ? MOCK_ERROR_CODE.TRANSLATION_MISMATCH
                  : null
            }
          : {
              ...remembered.paragraph,
              target: text,
              status: MOCK_PARAGRAPH_STATUS.EDITED,
              failCode: null
            };
      translations
        .get(request.recordId)
        ?.set(request.key, { ...remembered, paragraph: edited });
      return edited;
    },
    countTranslationRecords: async () => translations.size,
    deleteTranslationRecords: async () => {
      translations.clear();
    },
    copyText: async () => {},
    rememberTranslation,
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
