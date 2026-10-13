import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { GlossaryRow } from "@/renderer/entities/glossary";
import {
  firstRangePageOf,
  SOURCE_LANGUAGE
} from "@/renderer/entities/translation";
import type {
  RetranslateResult,
  SourceLanguage,
  TokenUsage,
  TranslatedParagraph,
  TranslateModel,
  TranslateProgress,
  TranslateRequest,
  TranslateStage,
  TranslationPlan,
  TranslationResult
} from "@/renderer/shared/api/bindings";
import type { PlatformErrorCode } from "@/renderer/shared/platform";
import type { ValueOf } from "@/renderer/shared/types/common";
import {
  RESULT_VIEW_MODE,
  RESULT_ZOOM,
  type ResultViewMode
} from "../config/translate-result";

/** 번역할 문서(`openFiles`로 연 PDF) */
export interface TranslateFile {
  /** 표시에 쓸 PDF 경로. 다이얼로그·드롭으로 받아 허용 경로 목록에 들어 있다(D13). */
  path: string;
  /** 화면에 보일 이름(확장자 포함) */
  name: string;
  sizeBytes: number;
  pageCount: number;
}

/** 옵션 화면에서 고른 값(시안 10). 문서를 바꾸면 처음 값으로 돌아간다. */
export interface TranslateSessionOptions {
  sourceLanguage: SourceLanguage;
  /** 1부터 센 쪽 범위(`"1,3-5"`, 비우면 전체) */
  range: string;
  includeScanPages: boolean;
  /** 고른 모델. `null`이면 설정의 기본 모델을 쓴다(설정을 바꾸면 따라간다). */
  model: TranslateModel | null;
  /** 이 문서의 용어(표에 적힌 그대로, 빈 칸 포함). 요청에는 공용 용어와 합쳐 정규화해 싣는다. */
  glossaryRows: GlossaryRow[];
}

/** 받은 계획 하나(성공이면 `plan`, 실패면 `errorCode`) */
export interface TranslationPlanEntry {
  /** 요청 키(문서·옵션·다시 받기 번호). 지금 옵션의 키와 같을 때만 실행 전 확인에 쓴다. */
  key: string;
  path: string;
  plan: TranslationPlan | null;
  errorCode: PlatformErrorCode | null;
}

/** 진행 카드 머리·사용량 상자에 보일 값. 시작할 때 정해 실행·실패 동안 그대로 둔다. */
export interface TranslateRunInfo {
  /** 시작할 때의 문서 이름(확장자 포함) */
  fileName: string;
  /** 원문 언어. 자동 감지면 계획이 감지한 언어(간체·번체를 가르지 않는다) */
  sourceLanguage: SourceLanguage | null;
  /** 계획의 예상 입력 + 출력 토큰(보낼 것만, 사용량 상자 "예상 합계") */
  estimatedTokens: number;
}

/** 진행 중인 번역(시안 12) */
export interface TranslateRun {
  jobId: string;
  request: TranslateRequest;
  info: TranslateRunInfo;
  /** 시작 시각(`Date.now()`, 경과 시간) */
  startedAt: number;
  /** 마지막으로 받은 진행률 */
  progress: TranslateProgress | null;
  /** 단계마다 마지막으로 받은 진행률. 지난 단계의 개수를 보인다. */
  stageProgress: Partial<Record<TranslateStage, TranslateProgress>>;
  isCancelRequested: boolean;
}

/** 실패한 번역. 진행 카드 자리에 원인·멈춘 곳을 보이고 같은 요청으로 다시 시도한다. */
export interface TranslateFailure {
  code: PlatformErrorCode;
  request: TranslateRequest;
  info: TranslateRunInfo;
  /** 멈출 때 마지막으로 받은 진행률(받기 전에 멈췄으면 `null`) */
  progress: TranslateProgress | null;
}

/** 실행하지 않을 때 번역 화면이 보이는 것. 결과는 끝난 번역이 있을 때만 보인다. */
export const TRANSLATE_VIEW = {
  OPTIONS: "options",
  RESULT: "result"
} as const;

export type TranslateView = ValueOf<typeof TRANSLATE_VIEW>;

/** 결과 화면(시안 13)에서 고른 보기. 모드를 오가도 남고, 새 결과를 받으면 쪽·고른 문단만 처음으로 돌린다. */
export interface TranslateResultView {
  viewMode: ResultViewMode;
  /** 보고 있는 쪽(0부터, 결과 `pages` 색인) */
  page: number;
  /** 글자 크기 배율(%) */
  zoomPercent: number;
  /** 고른 문단 키. 쪽을 옮기면 비운다. */
  activeParagraphKey: string | null;
}

/** 진행 중인 문단 다시 번역(한 번에 하나, Rust도 `JOB_ALREADY_RUNNING`으로 막는다) */
export interface TranslateRetranslation {
  jobId: string;
  /** 다시 번역하는 문단 키 */
  key: string;
}

interface StartRunParams {
  request: TranslateRequest;
  info: TranslateRunInfo;
  startedAt: number;
}

interface UpdateProgressParams {
  jobId: string;
  progress: TranslateProgress;
}

interface FinishRetranslationParams {
  jobId: string;
  /** 다시 번역을 보낸 결과의 기록 키. 그사이 결과가 바뀌었으면 받은 것을 버린다. */
  recordId: string;
  retranslated: RetranslateResult;
}

interface ReplaceResultParagraphParams {
  /** 고친 결과의 기록 키. 그사이 결과가 바뀌었으면 버린다. */
  recordId: string;
  paragraph: TranslatedParagraph;
}

interface ReplaceParagraphParams {
  result: TranslationResult;
  paragraph: TranslatedParagraph;
}

/** 결과에서 키가 같은 문단을 바꾼 새 결과(문단 키는 문서 안에서 하나다, ADR 0002 §3) */
function withParagraph({
  result,
  paragraph
}: ReplaceParagraphParams): TranslationResult {
  return {
    ...result,
    pages: result.pages.map((page) =>
      page.paragraphs.some((item) => item.key === paragraph.key)
        ? {
            ...page,
            paragraphs: page.paragraphs.map((item) =>
              item.key === paragraph.key ? paragraph : item
            )
          }
        : page
    )
  };
}

interface FindParagraphParams {
  result: TranslationResult;
  key: string;
}

function findParagraph({
  result,
  key
}: FindParagraphParams): TranslatedParagraph | undefined {
  return result.pages
    .flatMap((page) => page.paragraphs)
    .find((paragraph) => paragraph.key === key);
}

interface AddUsageParams {
  total: TokenUsage;
  added: TokenUsage;
}

function addUsage({ total, added }: AddUsageParams): TokenUsage {
  return {
    inputTokens: total.inputTokens + added.inputTokens,
    outputTokens: total.outputTokens + added.outputTokens
  };
}

/** 결과 첫 쪽(쪽 번호는 0부터) */
const FIRST_PAGE = 0;

const INITIAL_RESULT_VIEW: TranslateResultView = {
  viewMode: RESULT_VIEW_MODE.SIDE_BY_SIDE,
  page: FIRST_PAGE,
  zoomPercent: RESULT_ZOOM.DEFAULT_PERCENT,
  activeParagraphKey: null
};

const LAST_INDEX_OFFSET = 1;

interface ClampParams {
  value: number;
  min: number;
  max: number;
}

function clamp({ value, min, max }: ClampParams): number {
  return Math.min(max, Math.max(min, value));
}

const INITIAL_OPTIONS: TranslateSessionOptions = {
  sourceLanguage: SOURCE_LANGUAGE.AUTO,
  range: "",
  includeScanPages: false,
  model: null,
  glossaryRows: []
};

interface TranslateSessionState {
  file: TranslateFile | null;
  options: TranslateSessionOptions;
  /** 실행 전 확인의 외부 전송 동의 체크(시작하면 다시 비운다) */
  isTransferConsentChecked: boolean;
  /** 마지막으로 받은 계획 */
  plan: TranslationPlanEntry | null;
  /** 번역이 끝나면 늘린다. 같은 옵션이어도 기록이 바뀌었으니 계획을 다시 받는다. */
  planRevision: number;
  run: TranslateRun | null;
  failure: TranslateFailure | null;
  result: TranslationResult | null;
  /** 결과를 만든 요청(경로·옵션). 다시 번역·직접 고치기가 그대로 보낸다(ADR 0002 §10). */
  resultRequest: TranslateRequest | null;
  retranslation: TranslateRetranslation | null;
  view: TranslateView;
  resultView: TranslateResultView;
}

interface TranslateSessionActions {
  /** 문서를 넣거나 바꾼다. 옵션·동의·계획·결과는 처음으로 */
  setFile: (file: TranslateFile) => void;
  setSourceLanguage: (sourceLanguage: SourceLanguage) => void;
  setRange: (range: string) => void;
  setIncludeScanPages: (includeScanPages: boolean) => void;
  setModel: (model: TranslateModel) => void;
  setGlossaryRows: (glossaryRows: GlossaryRow[]) => void;
  setTransferConsentChecked: (isChecked: boolean) => void;
  receivePlan: (entry: TranslationPlanEntry) => void;
  /** 실행 상태로 바꾼다. 앞 실패는 지우고 동의 체크는 비운다. */
  startRun: (params: StartRunParams) => void;
  /** 진행 중인 작업의 진행률만 받는다(끝났거나 다른 작업의 늦은 보고는 버린다). */
  updateProgress: (params: UpdateProgressParams) => void;
  requestCancel: () => void;
  /**
   * 끝나면(성공·실패·취소) 실행을 비우고 계획을 다시 받게 한다(기록이 바뀌었다).
   * 성공이면 결과를 두고 결과 화면으로, 실패면 그 자리에 실패를 두고, 취소면 옵션 화면으로 간다.
   */
  completeRun: (result: TranslationResult) => void;
  failRun: (code: PlatformErrorCode) => void;
  cancelRun: () => void;
  /** 실패 화면을 닫고 옵션 화면으로 */
  closeFailure: () => void;
  /** 결과 화면에서 옵션 화면으로(결과는 남는다) */
  showOptions: () => void;
  /** 결과 화면 "새 번역": 문서·옵션·결과를 비운 옵션 화면(기록은 Rust 쪽에 남는다) */
  startNewTranslation: () => void;
  setResultViewMode: (viewMode: ResultViewMode) => void;
  /** 결과의 쪽으로 옮긴다(범위 밖 값은 끝 쪽으로 자른다). 고른 문단은 비운다. */
  setResultPage: (page: number) => void;
  /** 글자 크기 배율(50~200%로 자른다) */
  setResultZoomPercent: (zoomPercent: number) => void;
  selectParagraph: (key: string | null) => void;
  /** 다시 번역을 시작한다. 이미 하나가 돌고 있으면 그대로 둔다. */
  startRetranslation: (retranslation: TranslateRetranslation) => void;
  /**
   * 다시 번역을 끝낸다. 같은 결과면 사용량을 더하고 문단을 바꾼다. 실패·거절로 오면 원래 글이 있는 문단은
   * 그대로 둔다(Rust도 기록의 글을 그대로 둔다, ADR 0002 §10).
   */
  finishRetranslation: (params: FinishRetranslationParams) => void;
  /** 다시 번역이 오류로 멈췄다(결과는 그대로) */
  abortRetranslation: (jobId: string) => void;
  /** 직접 고친 문단으로 바꾼다 */
  replaceResultParagraph: (params: ReplaceResultParagraphParams) => void;
}

interface OptionChange<K extends keyof TranslateSessionOptions> {
  key: K;
  value: TranslateSessionOptions[K];
}

/** 번역 세션. 모드를 바꿔도 이 스토어에 그대로 남는다(계획서 P6-7). */
export const useTranslateSessionStore = create<
  TranslateSessionState & TranslateSessionActions
>((set) => {
  const setOption = <K extends keyof TranslateSessionOptions>({
    key,
    value
  }: OptionChange<K>) =>
    set((state) => ({ options: { ...state.options, [key]: value } }));
  return {
    file: null,
    options: INITIAL_OPTIONS,
    isTransferConsentChecked: false,
    plan: null,
    planRevision: 0,
    run: null,
    failure: null,
    result: null,
    resultRequest: null,
    retranslation: null,
    view: TRANSLATE_VIEW.OPTIONS,
    resultView: INITIAL_RESULT_VIEW,
    setFile: (file) =>
      set({
        file,
        options: INITIAL_OPTIONS,
        isTransferConsentChecked: false,
        plan: null,
        failure: null,
        result: null,
        resultRequest: null,
        view: TRANSLATE_VIEW.OPTIONS
      }),
    setSourceLanguage: (value) => setOption({ key: "sourceLanguage", value }),
    setRange: (value) => setOption({ key: "range", value }),
    setIncludeScanPages: (value) =>
      setOption({ key: "includeScanPages", value }),
    setModel: (value) => setOption({ key: "model", value }),
    setGlossaryRows: (value) => setOption({ key: "glossaryRows", value }),
    setTransferConsentChecked: (isTransferConsentChecked) =>
      set({ isTransferConsentChecked }),
    receivePlan: (plan) => set({ plan }),
    startRun: ({ request, info, startedAt }) =>
      set({
        run: {
          jobId: request.jobId,
          request,
          info,
          startedAt,
          progress: null,
          stageProgress: {},
          isCancelRequested: false
        },
        failure: null,
        isTransferConsentChecked: false
      }),
    updateProgress: ({ jobId, progress }) =>
      set((state) =>
        state.run?.jobId === jobId
          ? {
              run: {
                ...state.run,
                progress,
                stageProgress: {
                  ...state.run.stageProgress,
                  [progress.stage]: progress
                }
              }
            }
          : state
      ),
    requestCancel: () =>
      set((state) =>
        state.run ? { run: { ...state.run, isCancelRequested: true } } : state
      ),
    completeRun: (result) =>
      set((state) => ({
        run: null,
        result,
        resultRequest: state.run?.request ?? null,
        view: TRANSLATE_VIEW.RESULT,
        planRevision: state.planRevision + 1,
        resultView: {
          ...state.resultView,
          page: firstRangePageOf(result),
          activeParagraphKey: null
        }
      })),
    failRun: (code) =>
      set((state) => ({
        run: null,
        failure: state.run && {
          code,
          request: state.run.request,
          info: state.run.info,
          progress: state.run.progress
        },
        planRevision: state.planRevision + 1
      })),
    cancelRun: () =>
      set((state) => ({
        run: null,
        view: TRANSLATE_VIEW.OPTIONS,
        planRevision: state.planRevision + 1
      })),
    closeFailure: () => set({ failure: null, view: TRANSLATE_VIEW.OPTIONS }),
    showOptions: () => set({ view: TRANSLATE_VIEW.OPTIONS }),
    startNewTranslation: () =>
      set({
        file: null,
        options: INITIAL_OPTIONS,
        isTransferConsentChecked: false,
        plan: null,
        failure: null,
        result: null,
        resultRequest: null,
        view: TRANSLATE_VIEW.OPTIONS
      }),
    setResultViewMode: (viewMode) =>
      set((state) => ({ resultView: { ...state.resultView, viewMode } })),
    setResultPage: (page) =>
      set((state) => {
        if (state.result === null) return state;
        const nextPage = clamp({
          value: page,
          min: FIRST_PAGE,
          max: state.result.pages.length - LAST_INDEX_OFFSET
        });
        if (nextPage === state.resultView.page) return state;
        return {
          resultView: {
            ...state.resultView,
            page: nextPage,
            activeParagraphKey: null
          }
        };
      }),
    setResultZoomPercent: (zoomPercent) =>
      set((state) => ({
        resultView: {
          ...state.resultView,
          zoomPercent: clamp({
            value: zoomPercent,
            min: RESULT_ZOOM.MIN_PERCENT,
            max: RESULT_ZOOM.MAX_PERCENT
          })
        }
      })),
    selectParagraph: (activeParagraphKey) =>
      set((state) => ({
        resultView: { ...state.resultView, activeParagraphKey }
      })),
    startRetranslation: (retranslation) =>
      set((state) =>
        state.retranslation === null ? { retranslation } : state
      ),
    finishRetranslation: ({ jobId, recordId, retranslated }) =>
      set((state) => {
        if (state.retranslation?.jobId !== jobId) return state;
        if (state.result?.recordId !== recordId) return { retranslation: null };
        const { paragraph, usage } = retranslated;
        const current = findParagraph({
          result: state.result,
          key: paragraph.key
        });
        const isReplaced =
          paragraph.target !== null || current?.target === null;
        const result = isReplaced
          ? withParagraph({ result: state.result, paragraph })
          : state.result;
        return {
          retranslation: null,
          result: {
            ...result,
            usage: addUsage({ total: result.usage, added: usage })
          }
        };
      }),
    abortRetranslation: (jobId) =>
      set((state) =>
        state.retranslation?.jobId === jobId ? { retranslation: null } : state
      ),
    replaceResultParagraph: ({ recordId, paragraph }) =>
      set((state) =>
        state.result?.recordId === recordId
          ? { result: withParagraph({ result: state.result, paragraph }) }
          : state
      )
  };
});

export const useTranslateFile = () =>
  useTranslateSessionStore((state) => state.file);

export const useTranslateSessionOptions = () =>
  useTranslateSessionStore((state) => state.options);

export const useTranslateRun = () =>
  useTranslateSessionStore((state) => state.run);

/** 끝난 번역 결과(결과 화면). 없으면 `null` */
export const useTranslateResult = () =>
  useTranslateSessionStore((state) => state.result);

/** 다시 번역하는 문단 키(없으면 `null`) */
export const useRetranslatingParagraphKey = () =>
  useTranslateSessionStore((state) => state.retranslation?.key ?? null);

export const useTranslateResultView = () =>
  useTranslateSessionStore((state) => state.resultView);

/** 결과 화면 보기 바꾸기(보기 방식·쪽·배율·고른 문단) */
export const useTranslateResultViewActions = () =>
  useTranslateSessionStore(
    useShallow((state) => ({
      setViewMode: state.setResultViewMode,
      setPage: state.setResultPage,
      setZoomPercent: state.setResultZoomPercent,
      selectParagraph: state.selectParagraph
    }))
  );

/** 세션에 든 문서 경로(없으면 빈 목록). 모드를 오가도 문서를 다시 읽지 않게 잡아 두는 데 쓴다. */
export const useTranslateFilePaths = () =>
  useTranslateSessionStore(
    useShallow((state) => (state.file ? [state.file.path] : []))
  );

/**
 * 지금 문서로 마지막에 받은 계획(옵션이 달라도). 문서 전체 값(글자층·스캔 쪽 수)과 감지 배지·상태바 언어에 쓴다.
 * 옵션을 바꾼 뒤 새 계획을 받기 전에는 앞 계획의 값이 남는다.
 */
export const useTranslateFilePlan = (): TranslationPlan | null =>
  useTranslateSessionStore((state) =>
    state.file !== null && state.plan?.path === state.file.path
      ? state.plan.plan
      : null
  );

interface TranslateRunStatus {
  isRunning: boolean;
  /** 진행 중이 아니거나 아직 진행률을 받지 않았으면 0 */
  overallPercent: number;
  /** 실패 화면을 보이는 중 */
  hasFailure: boolean;
}

const NO_PROGRESS_PERCENT = 0;

/** 툴바·상태바용 요약(다른 모드 상태바 "번역 중 50%") */
export function useTranslateRunStatus(): TranslateRunStatus {
  const isRunning = useTranslateSessionStore((state) => state.run !== null);
  const overallPercent = useTranslateSessionStore(
    (state) => state.run?.progress?.overallPercent ?? NO_PROGRESS_PERCENT
  );
  const hasFailure = useTranslateSessionStore(
    (state) => state.failure !== null
  );
  return { isRunning, overallPercent, hasFailure };
}
