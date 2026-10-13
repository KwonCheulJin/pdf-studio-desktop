import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { GlossaryRow } from "@/renderer/entities/glossary";
import { SOURCE_LANGUAGE } from "@/renderer/entities/translation";
import type {
  SourceLanguage,
  TranslateModel,
  TranslateRequest,
  TranslationPlan,
  TranslationResult
} from "@/renderer/shared/api/bindings";
import type { PlatformErrorCode } from "@/renderer/shared/platform";

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

/** 진행 중인 번역(진행 화면은 Step 45) */
export interface TranslateRun {
  jobId: string;
  request: TranslateRequest;
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
  result: TranslationResult | null;
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
  startRun: (run: TranslateRun) => void;
  /** 끝나면(성공·실패·취소) 실행을 비우고 계획을 다시 받게 한다. 성공이면 결과를 둔다. */
  endRun: (result: TranslationResult | null) => void;
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
    result: null,
    setFile: (file) =>
      set({
        file,
        options: INITIAL_OPTIONS,
        isTransferConsentChecked: false,
        plan: null,
        result: null
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
    startRun: (run) => set({ run, isTransferConsentChecked: false }),
    endRun: (result) =>
      set((state) => ({
        run: null,
        result: result ?? state.result,
        planRevision: state.planRevision + 1
      }))
  };
});

export const useTranslateFile = () =>
  useTranslateSessionStore((state) => state.file);

export const useTranslateSessionOptions = () =>
  useTranslateSessionStore((state) => state.options);

export const useTranslateRun = () =>
  useTranslateSessionStore((state) => state.run);

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
