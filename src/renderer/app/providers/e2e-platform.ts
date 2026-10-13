import type {
  ApiKeyStatus,
  CompareProgress,
  CompareRequest,
  CompareResult,
  EditParagraphRequest,
  ErrorCode,
  ExportAnnotatedPdfRequest,
  ExportComparePdfRequest,
  MergeProgress,
  MergeRequest,
  OpenedFile,
  PreviewCompareReportRequest,
  RetranslateRequest,
  RetranslateResult,
  SourceLanguage,
  TranslateModel,
  TranslateProgress,
  TranslateRequest,
  TranslationPlan,
  TranslationResult
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
  type MockPlatform,
  type MockPdfFile,
  type MockUpdate,
  type NativeFileDropEvent,
  type PickSavePathOptions,
  type PlatformError,
  type PlatformErrorCode,
  type PrepareTranslationParams
} from "@/renderer/shared/platform";
import type { ValueOf } from "@/renderer/shared/types/common";

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
  /** 있으면 `checkForUpdate`가 이 코드로 실패한다(업데이터 플러그인 실패는 `IPC_FAILED`). */
  checkForUpdate?: PlatformErrorCode;
  /** 있으면 업데이트 `download`가 진행률을 보낸 뒤 이 코드로 실패한다. */
  downloadUpdate?: PlatformErrorCode;
}

/** `mergePdfs` 한 번의 흉내. 진행률을 차례로 보낸 뒤 `failCode`가 있으면 그 코드로 실패한다. */
export interface E2eMergeScript {
  progress: MergeProgress[];
  /** IPC로 온 값처럼 넘기므로 바인딩에 없는 코드도 넣을 수 있다(모르는 코드 표시 확인용). */
  failCode?: string;
  /** 실패를 일으킨 입력 파일(Rust `AppError.path`). 없으면 `null` */
  failPath?: string;
}

/**
 * `comparePdfs` 한 번의 흉내. 진행률을 차례로 보낸 뒤 `failCode`가 있으면 그 코드로 실패하고,
 * 아니면 mock 비교(경로·쪽 범위 검사, 마지막 100% 진행률)를 거쳐 `result`(없으면 차이 없는 결과)를 돌려준다.
 */
export interface E2eCompareScript {
  progress: CompareProgress[];
  /** IPC로 온 값처럼 넘기므로 바인딩에 없는 코드도 넣을 수 있다. */
  failCode?: string;
  /** 실패를 일으킨 입력 파일(Rust `AppError.path`). 없으면 `null` */
  failPath?: string;
  /** Rust golden JSON 같은 결과. 계약 JSON과 모양이 같다(ADR 0001 §7). */
  result?: CompareResult;
}

/**
 * `translatePdf` 한 번의 흉내. 진행률을 차례로 보낸 뒤 `failCode`가 있으면 그 코드로 실패하고, 아니면 mock 번역
 * (경로·쪽 범위·키 검사)을 거쳐 `result`(없으면 문단 없는 결과)를 돌려준다. `result`는 계약 JSON과 모양이 같다.
 */
export interface E2eTranslateScript {
  progress: TranslateProgress[];
  /** IPC로 온 값처럼 넘기므로 바인딩에 없는 코드도 넣을 수 있다. */
  failCode?: string;
  result?: TranslationResult;
}

/**
 * `retranslateParagraph` 한 번의 흉내. `__E2E_HOLD_RETRANSLATE__`를 기다린 뒤 `failCode`가 있으면 그 코드로
 * 실패하고, 아니면 mock 검사(경로·기록·문단·키)를 거쳐 `result`(없으면 기억한 문단 그대로·사용량 0)를 돌려준다.
 * `result`는 계약 JSON과 모양이 같아 실패·거절 문단(`target: null`)도 넣을 수 있다.
 */
export interface E2eRetranslateScript {
  /** IPC로 온 값처럼 넘기므로 바인딩에 없는 코드도 넣을 수 있다. */
  failCode?: string;
  result?: RetranslateResult;
}

/** 계획 시드를 고를 조건. 적은 값만 요청과 맞춰 본다(용어집은 정규화한 용어 수로). */
export interface E2ePlanMatch {
  path?: string;
  sourceLanguage?: SourceLanguage;
  range?: string;
  includeScanPages?: boolean;
  model?: TranslateModel;
  glossaryCount?: number;
}

/**
 * `prepareTranslation`이 돌려줄 계획. mock 검사(경로·쪽 범위)를 거친 뒤 앞에서부터 `match`가 맞는 첫 시드를 쓰고,
 * 맞는 것이 없으면 mock 계획(문단·예상치 0, 언어 모름)이다.
 */
export interface E2eTranslationPlan {
  match?: E2ePlanMatch;
  plan: TranslationPlan;
  /** 한 번 쓰면 지운다. 같은 옵션이어도 번역 뒤(기록이 바뀐 뒤) 다른 계획을 주려고 앞에 둔다. */
  once?: boolean;
}

export interface E2eMockSeed {
  files: E2eMockFile[];
  /** 열기 다이얼로그를 열 때마다 앞에서부터 하나씩 고를 경로 목록. 다 쓰면 `files`를 모두 고른다. */
  dialogPicks?: string[][];
  failures?: E2eMockFailures;
  /** `mergePdfs`를 부를 때마다 앞에서부터 하나씩 쓴다. 다 쓰면 mock 그대로 성공한다. */
  mergeScripts?: E2eMergeScript[];
  /** `comparePdfs`를 부를 때마다 앞에서부터 하나씩 쓴다. 다 쓰면 mock 그대로 차이 없이 성공한다. */
  compareScripts?: E2eCompareScript[];
  /** 있으면 `temp` 출력 병합 결과가 이 경로·파일 이름이 된다. */
  mergeOutput?: MockMergeOutput;
  /** 있으면 `readThirdPartyNotices`가 이 원문을 돌려준다. 없으면 리소스 없음 오류다. */
  thirdPartyNotices?: string;
  /** 폴더 다이얼로그를 열 때마다 앞에서부터 하나씩 고를 폴더(`null`은 취소). 다 쓰면 `/mock/exports` */
  directoryPicks?: (string | null)[];
  /** 있으면 `checkForUpdate`가 이 새 버전을 알린다. 없으면 최신 버전일 때처럼 알리지 않는다. */
  update?: MockUpdate;
  /** 시작할 때의 API 키 상태. 없으면 등록되지 않았다. */
  apiKey?: ApiKeyStatus;
  /** 시작할 때 저장돼 있는 번역 기록의 ID들(설정 '일반'의 저장된 번역 수). 없으면 0개다. */
  savedRecordIds?: string[];
  /**
   * `verifyApiKey`가 형식 검사를 통과할 때마다 앞에서부터 하나씩 쓰는 확인 결과(`null`은 성공, 코드는 그 코드로
   * 실패). 다 쓰면 성공한다.
   */
  apiKeyChecks?: (ErrorCode | null)[];
  /** `translatePdf`를 부를 때마다 앞에서부터 하나씩 쓴다. 다 쓰면 mock 그대로 문단 없는 결과다. */
  translateScripts?: E2eTranslateScript[];
  /** 옵션별 계획(`prepareTranslation`). 쓰고 나도 남는다(같은 옵션이면 같은 계획). */
  translationPlans?: E2eTranslationPlan[];
  /** `retranslateParagraph`를 부를 때마다 앞에서부터 하나씩 쓴다. 다 쓰면 mock 그대로다. */
  retranslateScripts?: E2eRetranslateScript[];
}

/** 시드 키 확인 실패의 로그용 설명 */
const VERIFY_API_KEY_DETAIL = "verifyApiKey";

/** 작업 취소를 Rust처럼 알리는 코드 */
const CANCELLED_CODE = "CANCELLED" satisfies ErrorCode;

/** 파일을 쓰거나 지우거나 작업을 멈추는 플랫폼 호출 */
export const E2E_WRITE_METHOD = {
  MERGE_PDFS: "mergePdfs",
  CANCEL_JOB: "cancelJob",
  COPY_FILE: "copyFile",
  DISCARD_TEMP: "discardTemp",
  EXPORT_COMPARE_PDF: "exportComparePdf",
  EXPORT_ANNOTATED_PDF: "exportAnnotatedPdf",
  SAVE_API_KEY: "saveApiKey",
  DELETE_API_KEY: "deleteApiKey",
  EDIT_TRANSLATED_PARAGRAPH: "editTranslatedParagraph",
  DELETE_TRANSLATION_RECORDS: "deleteTranslationRecords"
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

interface ExportComparePdfCall {
  method: typeof E2E_WRITE_METHOD.EXPORT_COMPARE_PDF;
  request: ExportComparePdfRequest;
}

interface ExportAnnotatedPdfCall {
  method: typeof E2E_WRITE_METHOD.EXPORT_ANNOTATED_PDF;
  request: ExportAnnotatedPdfRequest;
}

interface SaveApiKeyCall {
  method: typeof E2E_WRITE_METHOD.SAVE_API_KEY;
  key: string;
}

interface DeleteApiKeyCall {
  method: typeof E2E_WRITE_METHOD.DELETE_API_KEY;
}

interface EditTranslatedParagraphCall {
  method: typeof E2E_WRITE_METHOD.EDIT_TRANSLATED_PARAGRAPH;
  request: EditParagraphRequest;
}

interface DeleteTranslationRecordsCall {
  method: typeof E2E_WRITE_METHOD.DELETE_TRANSLATION_RECORDS;
}

/** 업데이트 호출(확인·받기·설치와 재시작) */
export const E2E_UPDATE_METHOD = {
  CHECK: "checkForUpdate",
  DOWNLOAD: "download",
  INSTALL_AND_RESTART: "installAndRestart"
} as const;

export type E2eUpdateCall = ValueOf<typeof E2E_UPDATE_METHOD>;

export type E2eWriteCall =
  | MergePdfsCall
  | CancelJobCall
  | CopyFileCall
  | DiscardTempCall
  | ExportComparePdfCall
  | ExportAnnotatedPdfCall
  | SaveApiKeyCall
  | DeleteApiKeyCall
  | EditTranslatedParagraphCall
  | DeleteTranslationRecordsCall;

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
    /**
     * 테스트가 넣으면 비교 요청을 스크립트 진행률을 보낸 뒤 이 Promise가 풀릴 때까지 붙잡는다
     * (진행 화면 확인용). 붙잡힌 동안 `cancelJob`이 오면 바로 `CANCELLED`로 실패한다.
     */
    __E2E_HOLD_COMPARE__?: Promise<void>;
    /** `__E2E_HOLD_COMPARE__`를 푸는 함수. 테스트가 함께 넣는다. */
    __E2E_RELEASE_COMPARE__?: () => void;
    /**
     * 테스트가 넣으면 `readPdf`가 이 Promise가 풀릴 때까지 바이트를 돌려주지 않는다
     * (쪽을 받기 전 스켈레톤 확인용).
     */
    __E2E_HOLD_READ_PDF__?: Promise<void>;
    /** `__E2E_HOLD_READ_PDF__`를 푸는 함수. 테스트가 함께 넣는다. */
    __E2E_RELEASE_READ_PDF__?: () => void;
    /** 앱이 보낸 비교 요청(`comparePdfs`)을 부른 순서대로 기록하는 곳 */
    __E2E_MOCK_COMPARES__?: CompareRequest[];
    /** 앱이 저장 다이얼로그(`pickSavePath`)를 연 옵션을 부른 순서대로 기록하는 곳 */
    __E2E_MOCK_SAVE_DIALOGS__?: PickSavePathOptions[];
    /** 앱이 보낸 리포트 미리보기 요청(`previewCompareReport`)을 부른 순서대로 기록하는 곳 */
    __E2E_MOCK_PREVIEWS__?: PreviewCompareReportRequest[];
    /** 응답(성공·실패)을 돌려준 미리보기 요청 수. 늦게 온 응답을 앱이 받은 뒤를 기다릴 때 쓴다. */
    __E2E_MOCK_PREVIEWS_SETTLED__?: number;
    /**
     * 테스트가 넣으면 그 뒤에 온 미리보기 요청을 이 Promise가 풀릴 때까지 붙잡는다(요청할 때의 값을 본다).
     * 오래된 응답이 나중에 와도 새 응답을 덮지 않는지 확인한다.
     */
    __E2E_HOLD_PREVIEW__?: Promise<void>;
    /** `__E2E_HOLD_PREVIEW__`를 푸는 함수. 테스트가 함께 넣는다. */
    __E2E_RELEASE_PREVIEW__?: () => void;
    /**
     * 테스트가 넣으면 내보내기 요청을 이 Promise가 풀릴 때까지 붙잡는다(내보내는 중 화면 확인용).
     * 붙잡힌 동안 같은 작업 ID로 `cancelJob`이 오면 바로 `CANCELLED`로 실패한다.
     */
    __E2E_HOLD_EXPORT__?: Promise<void>;
    /** 앱이 부른 업데이트 호출을 부른 순서대로 기록하는 곳 */
    __E2E_MOCK_UPDATES__?: E2eUpdateCall[];
    /**
     * 테스트가 넣으면 업데이트 `download`가 진행률을 보낸 뒤 이 Promise가 풀릴 때까지 끝나지 않는다
     * (받는 중 화면 확인용).
     */
    __E2E_HOLD_UPDATE_DOWNLOAD__?: Promise<void>;
    /** `__E2E_HOLD_UPDATE_DOWNLOAD__`를 푸는 함수. 테스트가 함께 넣는다. */
    __E2E_RELEASE_UPDATE_DOWNLOAD__?: () => void;
    /**
     * 테스트가 넣으면 번역 요청을 스크립트 진행률을 보낸 뒤 이 Promise가 풀릴 때까지 붙잡는다(진행 화면 확인용).
     * 붙잡힌 동안 같은 작업 ID로 `cancelJob`이 오면 바로 `CANCELLED`로 실패한다.
     */
    __E2E_HOLD_TRANSLATE__?: Promise<void>;
    /** `__E2E_HOLD_TRANSLATE__`를 푸는 함수. 테스트가 함께 넣는다. */
    __E2E_RELEASE_TRANSLATE__?: () => void;
    /** 앱이 보낸 번역 요청(`translatePdf`, 옵션 포함)을 부른 순서대로 기록하는 곳 */
    __E2E_MOCK_TRANSLATES__?: TranslateRequest[];
    /**
     * 테스트가 넣으면 다시 번역 요청을 이 Promise가 풀릴 때까지 붙잡는다(진행 표시·한 번에 하나 확인용).
     * 붙잡힌 동안 같은 작업 ID로 `cancelJob`이 오면 바로 `CANCELLED`로 실패한다.
     */
    __E2E_HOLD_RETRANSLATE__?: Promise<void>;
    /** `__E2E_HOLD_RETRANSLATE__`를 푸는 함수. 테스트가 함께 넣는다. */
    __E2E_RELEASE_RETRANSLATE__?: () => void;
    /** 앱이 보낸 다시 번역 요청(`retranslateParagraph`, 옵션 포함)을 부른 순서대로 기록하는 곳 */
    __E2E_MOCK_RETRANSLATES__?: RetranslateRequest[];
    /** 앱이 보낸 계획 요청(`prepareTranslation`, 옵션 포함)을 부른 순서대로 기록하는 곳 */
    __E2E_MOCK_PLANS__?: PrepareTranslationParams[];
    /** 응답(성공·실패)을 돌려준 계획 요청 수. 늦게 온 응답을 앱이 받은 뒤를 기다릴 때 쓴다. */
    __E2E_MOCK_PLANS_SETTLED__?: number;
    /**
     * 테스트가 넣으면 그 뒤에 온 계획 요청을 이 Promise가 풀릴 때까지 붙잡는다(요청할 때의 값을 본다).
     * 받는 동안의 "…"와 늦게 온 앞 응답을 버리는지 확인한다.
     */
    __E2E_HOLD_PLAN__?: Promise<void>;
    /** `__E2E_HOLD_PLAN__`을 푸는 함수. 테스트가 함께 넣는다. */
    __E2E_RELEASE_PLAN__?: () => void;
    /** 앱이 클립보드에 복사한 글(`copyText`)을 차례로 기록하는 곳 */
    __E2E_MOCK_CLIPBOARD__?: string[];
    /** 앱이 `verifyApiKey`를 부른 수(키 원문은 남기지 않는다) */
    __E2E_MOCK_KEY_CHECKS__?: number;
    /**
     * 테스트가 넣으면 형식 검사를 통과한 키 확인(`verifyApiKey`)을 이 Promise가 풀릴 때까지 붙잡는다
     * (확인 중 화면·늦은 응답 확인용).
     */
    __E2E_HOLD_VERIFY_API_KEY__?: Promise<void>;
    /** `__E2E_HOLD_VERIFY_API_KEY__`를 푸는 함수. 테스트가 함께 넣는다. */
    __E2E_RELEASE_VERIFY_API_KEY__?: () => void;
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
    },
    exportComparePdf: (request) => {
      writes.push({ method: E2E_WRITE_METHOD.EXPORT_COMPARE_PDF, request });
      return platform.exportComparePdf(request);
    },
    exportAnnotatedPdf: (request) => {
      writes.push({ method: E2E_WRITE_METHOD.EXPORT_ANNOTATED_PDF, request });
      return platform.exportAnnotatedPdf(request);
    },
    saveApiKey: (key) => {
      writes.push({ method: E2E_WRITE_METHOD.SAVE_API_KEY, key });
      return platform.saveApiKey(key);
    },
    deleteApiKey: () => {
      writes.push({ method: E2E_WRITE_METHOD.DELETE_API_KEY });
      return platform.deleteApiKey();
    },
    editTranslatedParagraph: (request) => {
      writes.push({
        method: E2E_WRITE_METHOD.EDIT_TRANSLATED_PARAGRAPH,
        request
      });
      return platform.editTranslatedParagraph(request);
    },
    deleteTranslationRecords: () => {
      writes.push({ method: E2E_WRITE_METHOD.DELETE_TRANSLATION_RECORDS });
      return platform.deleteTranslationRecords();
    }
  };
}

interface HoldParams {
  jobId: string;
  hold: Promise<void> | undefined;
}

interface InjectFailuresParams {
  platform: DesktopPlatform;
  failures: E2eMockFailures;
  mergeScripts: E2eMergeScript[];
  compareScripts: E2eCompareScript[];
  translateScripts: E2eTranslateScript[];
  retranslateScripts: E2eRetranslateScript[];
  apiKeyChecks: (ErrorCode | null)[];
  /** 시드 번역 결과를 mock에 알린다(다시 번역·직접 고치기가 그 문단을 찾는다). */
  rememberTranslation: MockPlatform["rememberTranslation"];
}

/**
 * 시드대로 실패·진행률을 흉내 낸다. `mergePdfs`·`comparePdfs`·`translatePdf`는 스크립트의 진행률을 보낸 뒤
 * `__E2E_HOLD_MERGE__`·`__E2E_HOLD_COMPARE__`·`__E2E_HOLD_TRANSLATE__`를, `retranslateParagraph`는
 * `__E2E_HOLD_RETRANSLATE__`를 기다리고, 그동안 같은 작업의 `cancelJob`이 오면 Rust처럼 `CANCELLED`로 실패한다.
 */
function injectFailures({
  platform,
  failures,
  mergeScripts,
  compareScripts,
  translateScripts,
  retranslateScripts,
  apiKeyChecks,
  rememberTranslation
}: InjectFailuresParams): DesktopPlatform {
  const openFailures = failures.openFiles ?? {};
  const cancelledJobs = new Set<string>();
  const cancelWaiters = new Map<string, () => void>();

  /** 붙잡기가 풀리거나 같은 작업이 취소될 때까지 기다린다. 취소됐으면 `CANCELLED`로 실패한다. */
  const waitForRelease = async ({ jobId, hold }: HoldParams): Promise<void> => {
    const cancelled = new Promise<void>((resolve) => {
      cancelWaiters.set(jobId, resolve);
    });
    await Promise.race([hold, cancelled]);
    cancelWaiters.delete(jobId);
    if (cancelledJobs.has(jobId)) {
      throw seededError({ code: CANCELLED_CODE, detail: jobId });
    }
  };

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
      await waitForRelease({ jobId, hold: window.__E2E_HOLD_MERGE__ });
      if (script?.failCode !== undefined) {
        throw seededError({
          code: script.failCode,
          path: script.failPath,
          detail: jobId
        });
      }
      return platform.mergePdfs(params);
    },
    comparePdfs: async (params) => {
      const { jobId } = params.request;
      const script = compareScripts.shift();
      for (const progress of script?.progress ?? []) {
        params.onProgress?.(progress);
      }
      await waitForRelease({ jobId, hold: window.__E2E_HOLD_COMPARE__ });
      if (script?.failCode !== undefined) {
        throw seededError({
          code: script.failCode,
          path: script.failPath,
          detail: jobId
        });
      }
      const result = await platform.comparePdfs(params);
      return script?.result ?? result;
    },
    previewCompareReport: async (request) => {
      await window.__E2E_HOLD_PREVIEW__;
      return platform.previewCompareReport(request);
    },
    exportComparePdf: async (request) => {
      await waitForRelease({
        jobId: request.jobId,
        hold: window.__E2E_HOLD_EXPORT__
      });
      return platform.exportComparePdf(request);
    },
    exportAnnotatedPdf: async (request) => {
      await waitForRelease({
        jobId: request.jobId,
        hold: window.__E2E_HOLD_EXPORT__
      });
      return platform.exportAnnotatedPdf(request);
    },
    // Rust처럼 형식 검사를 먼저 하고(네트워크 전), 통과하면 붙잡기를 기다린 뒤(네트워크 흉내) 시드 확인 결과를 쓴다.
    verifyApiKey: async (key) => {
      window.__E2E_MOCK_KEY_CHECKS__ =
        (window.__E2E_MOCK_KEY_CHECKS__ ?? 0) + 1;
      await platform.verifyApiKey(key);
      await window.__E2E_HOLD_VERIFY_API_KEY__;
      const code = apiKeyChecks.shift();
      if (code !== undefined && code !== null) {
        throw seededError({ code, detail: VERIFY_API_KEY_DETAIL });
      }
    },
    translatePdf: async (params) => {
      const { jobId } = params.request;
      const script = translateScripts.shift();
      for (const progress of script?.progress ?? []) {
        params.onProgress?.(progress);
      }
      await waitForRelease({ jobId, hold: window.__E2E_HOLD_TRANSLATE__ });
      if (script?.failCode !== undefined) {
        throw seededError({ code: script.failCode, detail: jobId });
      }
      const result = await platform.translatePdf(params);
      if (script?.result === undefined) return result;
      rememberTranslation(script.result);
      return script.result;
    },
    retranslateParagraph: async (request) => {
      const { jobId } = request;
      const script = retranslateScripts.shift();
      await waitForRelease({ jobId, hold: window.__E2E_HOLD_RETRANSLATE__ });
      if (script?.failCode !== undefined) {
        throw seededError({ code: script.failCode, detail: jobId });
      }
      const result = await platform.retranslateParagraph(request);
      return script?.result ?? result;
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

/** `readPdf` 호출 경로를 위임 전에 기록하고, `__E2E_HOLD_READ_PDF__`가 있으면 풀릴 때까지 기다린다. */
function recordReads({ platform, reads }: RecordReadsParams): DesktopPlatform {
  return {
    ...platform,
    readPdf: async (path) => {
      reads.push(path);
      await window.__E2E_HOLD_READ_PDF__;
      return platform.readPdf(path);
    }
  };
}

interface RecordComparesParams {
  platform: DesktopPlatform;
  compares: CompareRequest[];
}

/** 비교 요청(옵션 포함)을 위임 전에 기록한다. 거부된 요청도 남는다. */
function recordCompares({
  platform,
  compares
}: RecordComparesParams): DesktopPlatform {
  return {
    ...platform,
    comparePdfs: (params) => {
      compares.push(params.request);
      return platform.comparePdfs(params);
    }
  };
}

interface RecordPreviewsParams {
  platform: DesktopPlatform;
  previews: PreviewCompareReportRequest[];
}

/** 리포트 미리보기 요청(옵션 포함)을 위임 전에 기록하고, 응답이 오면 그 수를 센다. 거부된 요청도 남는다. */
function recordPreviews({
  platform,
  previews
}: RecordPreviewsParams): DesktopPlatform {
  return {
    ...platform,
    previewCompareReport: async (request) => {
      previews.push(request);
      try {
        return await platform.previewCompareReport(request);
      } finally {
        window.__E2E_MOCK_PREVIEWS_SETTLED__ =
          (window.__E2E_MOCK_PREVIEWS_SETTLED__ ?? 0) + 1;
      }
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

interface RecordTranslatesParams {
  platform: DesktopPlatform;
  translates: TranslateRequest[];
  retranslates: RetranslateRequest[];
}

/** 번역·다시 번역 요청(옵션 포함)을 위임 전에 기록한다. 거부된 요청도 남는다. */
function recordTranslates({
  platform,
  translates,
  retranslates
}: RecordTranslatesParams): DesktopPlatform {
  return {
    ...platform,
    translatePdf: (params) => {
      translates.push(params.request);
      return platform.translatePdf(params);
    },
    retranslateParagraph: (request) => {
      retranslates.push(request);
      return platform.retranslateParagraph(request);
    }
  };
}

/** 시드 조건이 요청과 맞는가(적지 않은 값은 보지 않는다) */
interface MatchesPlanParams extends PrepareTranslationParams {
  match: E2ePlanMatch;
}

function matchesPlan({ match, path, options }: MatchesPlanParams): boolean {
  const actual: Required<E2ePlanMatch> = {
    path,
    sourceLanguage: options.sourceLanguage,
    range: options.range,
    includeScanPages: options.includeScanPages,
    model: options.model,
    glossaryCount: options.glossary.length
  };
  return (Object.keys(match) as (keyof E2ePlanMatch)[]).every(
    (key) => match[key] === actual[key]
  );
}

interface SeedPlansParams {
  platform: DesktopPlatform;
  plans: E2eTranslationPlan[];
  requests: PrepareTranslationParams[];
}

/**
 * 계획 요청을 위임 전에 기록하고, 요청할 때의 `__E2E_HOLD_PLAN__`을 기다린 뒤 mock 검사를 거쳐 맞는 시드 계획을
 * 돌려준다. 응답을 돌려준 수를 센다(거부도 센다).
 */
function seedPlans({
  platform,
  plans,
  requests
}: SeedPlansParams): DesktopPlatform {
  return {
    ...platform,
    prepareTranslation: async (params) => {
      const request = structuredClone(params);
      requests.push(request);
      const hold = window.__E2E_HOLD_PLAN__;
      try {
        await hold;
        const mockPlan = await platform.prepareTranslation(params);
        const index = plans.findIndex(
          (seed) =>
            seed.match === undefined ||
            matchesPlan({ match: seed.match, ...request })
        );
        const seeded = plans[index];
        if (seeded === undefined) return mockPlan;
        if (seeded.once === true) plans.splice(index, 1);
        return seeded.plan;
      } finally {
        window.__E2E_MOCK_PLANS_SETTLED__ =
          (window.__E2E_MOCK_PLANS_SETTLED__ ?? 0) + 1;
      }
    }
  };
}

interface RecordClipboardParams {
  platform: DesktopPlatform;
  clipboard: string[];
}

/** 복사한 글을 기록한다(실제 클립보드 대신). */
function recordClipboard({
  platform,
  clipboard
}: RecordClipboardParams): DesktopPlatform {
  return {
    ...platform,
    copyText: async (text) => {
      clipboard.push(text);
      await platform.copyText(text);
    }
  };
}

interface SeedUpdatesParams {
  platform: DesktopPlatform;
  failures: E2eMockFailures;
  calls: E2eUpdateCall[];
}

/**
 * 업데이트 호출을 위임 전에 기록하고 시드대로 실패시킨다. 받기는 진행률을 보낸 뒤
 * `__E2E_HOLD_UPDATE_DOWNLOAD__`를 기다린다.
 */
function seedUpdates({
  platform,
  failures,
  calls
}: SeedUpdatesParams): DesktopPlatform {
  return {
    ...platform,
    checkForUpdate: async () => {
      calls.push(E2E_UPDATE_METHOD.CHECK);
      if (failures.checkForUpdate !== undefined) {
        throw seededError({
          code: failures.checkForUpdate,
          detail: E2E_UPDATE_METHOD.CHECK
        });
      }
      const update = await platform.checkForUpdate();
      if (update === null) return null;
      return {
        version: update.version,
        download: async (onProgress) => {
          calls.push(E2E_UPDATE_METHOD.DOWNLOAD);
          await update.download(onProgress);
          await window.__E2E_HOLD_UPDATE_DOWNLOAD__;
          if (failures.downloadUpdate !== undefined) {
            throw seededError({
              code: failures.downloadUpdate,
              detail: E2E_UPDATE_METHOD.DOWNLOAD
            });
          }
        },
        installAndRestart: async () => {
          calls.push(E2E_UPDATE_METHOD.INSTALL_AND_RESTART);
          await update.installAndRestart();
        }
      };
    }
  };
}

/** 설정을 페이지 저장소에 두는 키 앞부분. 새로고침해도 남아 재시작처럼 확인할 수 있다. */
const SETTING_STORAGE_PREFIX = "e2e-setting:";

/** 키를 저장하면 Rust가 `false`로 되돌리는 설정(ADR 0002 §13) */
const TRANSFER_CONFIRMED_ONCE_SETTING = "translate.transferConfirmedOnce";

/**
 * 설정 읽기·쓰기를 `localStorage`에 둔다(Tauri `plugin-store` 파일 대신).
 * Playwright는 테스트마다 새 브라우저 컨텍스트라 테스트끼리 섞이지 않는다.
 */
function persistSettings(platform: DesktopPlatform): DesktopPlatform {
  const setSetting: DesktopPlatform["setSetting"] = async ({ key, value }) => {
    localStorage.setItem(
      `${SETTING_STORAGE_PREFIX}${key}`,
      JSON.stringify(value)
    );
  };
  return {
    ...platform,
    getSetting: async (key) => {
      const stored = localStorage.getItem(`${SETTING_STORAGE_PREFIX}${key}`);
      return stored === null ? undefined : JSON.parse(stored);
    },
    setSetting,
    // Rust `save_api_key`처럼 새 키는 외부 전송 확인을 다시 받게 한다(설정은 이 저장소에 있다).
    saveApiKey: async (key) => {
      const status = await platform.saveApiKey(key);
      await setSetting({ key: TRANSFER_CONFIRMED_ONCE_SETTING, value: false });
      return status;
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
  const compares: CompareRequest[] = [];
  const previews: PreviewCompareReportRequest[] = [];
  const translates: TranslateRequest[] = [];
  const retranslates: RetranslateRequest[] = [];
  const planRequests: PrepareTranslationParams[] = [];
  const clipboard: string[] = [];
  const updateCalls: E2eUpdateCall[] = [];
  window.__E2E_MOCK_WRITES__ = writes;
  window.__E2E_MOCK_UPDATES__ = updateCalls;
  window.__E2E_MOCK_PREVIEWS__ = previews;
  window.__E2E_MOCK_COMPARES__ = compares;
  window.__E2E_MOCK_READS__ = reads;
  window.__E2E_MOCK_SAVE_DIALOGS__ = saveDialogs;
  window.__E2E_MOCK_TRANSLATES__ = translates;
  window.__E2E_MOCK_RETRANSLATES__ = retranslates;
  window.__E2E_MOCK_PLANS__ = planRequests;
  window.__E2E_MOCK_PLANS_SETTLED__ = 0;
  window.__E2E_MOCK_CLIPBOARD__ = clipboard;
  window.__E2E_MOCK_KEY_CHECKS__ = 0;
  window.__E2E_PDF_CACHE_STATS__ = getPdfCacheStats;
  const mockPlatform = createMockPlatform({
    files: seed.files.map(toMockFile),
    dialogPicks: seed.dialogPicks,
    mergeOutput: seed.mergeOutput,
    thirdPartyNotices: seed.thirdPartyNotices,
    directoryPicks: seed.directoryPicks,
    update: seed.update,
    apiKey: seed.apiKey,
    savedRecordIds: seed.savedRecordIds
  });
  window.__E2E_FILE_DROP__ = mockPlatform.simulateFileDrop;
  const seededPlatform = injectFailures({
    platform: mockPlatform,
    failures: seed.failures ?? {},
    mergeScripts: [...(seed.mergeScripts ?? [])],
    compareScripts: [...(seed.compareScripts ?? [])],
    translateScripts: [...(seed.translateScripts ?? [])],
    retranslateScripts: [...(seed.retranslateScripts ?? [])],
    apiKeyChecks: [...(seed.apiKeyChecks ?? [])],
    rememberTranslation: mockPlatform.rememberTranslation
  });
  return persistSettings(
    seedUpdates({
      platform: recordClipboard({
        platform: seedPlans({
          platform: recordTranslates({
            platform: recordSaveDialogs({
              platform: recordPreviews({
                platform: recordCompares({
                  platform: recordReads({
                    platform: recordWrites(seededPlatform, writes),
                    reads
                  }),
                  compares
                }),
                previews
              }),
              saveDialogs
            }),
            translates,
            retranslates
          }),
          plans: [...(seed.translationPlans ?? [])],
          requests: planRequests
        }),
        clipboard
      }),
      failures: seed.failures ?? {},
      calls: updateCalls
    })
  );
}
