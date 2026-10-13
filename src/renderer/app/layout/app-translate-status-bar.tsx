import {
  baseSourceLanguageOf,
  paragraphCountOf,
  SOURCE_LANGUAGE,
  SOURCE_LANGUAGE_LABEL,
  TARGET_LANGUAGE_LABEL
} from "@/renderer/entities/translation";
import {
  TRANSLATE_SCREEN,
  translateResultText,
  useTranslateFile,
  useTranslateFilePlan,
  useTranslateResult,
  useTranslateRunStatus,
  useTranslateScreen,
  useTranslateSessionOptions
} from "@/renderer/features/pdf-translate";
import { ThirdPartyNoticesButton } from "@/renderer/features/third-party-notices";
import type { TranslationResult } from "@/renderer/shared/api/bindings";
import { APP_STATUS } from "@/renderer/shared/constants";
import { CompareRunIndicator } from "./compare-run-indicator";
import { translateRunningText } from "./translate-run-indicator";

const EMPTY_FILE_TEXT = "비어 있음";

/** 원문 언어 이름: 고른 언어, 자동 감지면 감지한 언어(간체·번체를 가르지 않는다). 모르면 `null` */
function useSourceLanguageName(): string | null {
  const { sourceLanguage } = useTranslateSessionOptions();
  const plan = useTranslateFilePlan();
  const language =
    sourceLanguage === SOURCE_LANGUAGE.AUTO
      ? plan && baseSourceLanguageOf(plan.detectedLanguage)
      : sourceLanguage;
  return language ? SOURCE_LANGUAGE_LABEL[language] : null;
}

const SEPARATOR_CLASS = "mx-2";

interface ResultSummaryProps {
  result: TranslationResult;
}

/** 결과 화면 상태바 왼쪽(시안 13): `문단 318개 | 사용 입력 31,420 · 출력 35,880 토큰`(기록 누적) */
function ResultSummary({ result }: ResultSummaryProps) {
  return (
    <span>
      {translateResultText.statusParagraphs(paragraphCountOf(result))}
      <span className={SEPARATOR_CLASS}>|</span>
      {translateResultText.statusUsage(result.usage)}
    </span>
  );
}

/** 옵션·진행 화면 상태바 왼쪽(시안 10·12): 쪽수(파일이 없으면 "비어 있음")와 `중국어 → 한국어`(원문 언어를 알 때) */
function DocumentSummary() {
  const file = useTranslateFile();
  const sourceLanguageName = useSourceLanguageName();
  return (
    <span>
      {file ? `${file.pageCount}쪽` : EMPTY_FILE_TEXT}
      {file && sourceLanguageName && (
        <>
          <span className={SEPARATOR_CLASS}>|</span>
          {`${sourceLanguageName} → ${TARGET_LANGUAGE_LABEL}`}
        </>
      )}
    </span>
  );
}

interface StatusTextParams {
  isRunning: boolean;
  overallPercent: number;
  hasFailure: boolean;
  isShowingResult: boolean;
}

function statusTextOf({
  isRunning,
  overallPercent,
  hasFailure,
  isShowingResult
}: StatusTextParams): string {
  if (isRunning) return translateRunningText(overallPercent);
  if (hasFailure) return APP_STATUS.ERROR;
  return isShowingResult ? APP_STATUS.COMPLETE : APP_STATUS.READY;
}

/**
 * 번역 화면 상태바(시안 10·12·13): 왼쪽에 문서 요약(결과 화면이면 문단 수·사용 토큰),
 * 오른쪽에 상태("준비"·"번역 중 50%"·실패면 "오류"·결과 화면이면 "완료")·버전
 */
export function AppTranslateStatusBar() {
  const screen = useTranslateScreen();
  const result = useTranslateResult();
  const { isRunning, overallPercent, hasFailure } = useTranslateRunStatus();
  const isShowingResult = screen === TRANSLATE_SCREEN.RESULT && result !== null;
  const statusText = statusTextOf({
    isRunning,
    overallPercent,
    hasFailure,
    isShowingResult
  });
  return (
    <footer className="border-border bg-background text-muted-foreground flex h-10 shrink-0 items-center justify-between gap-4 border-t px-6 text-sm">
      {isShowingResult ? (
        <ResultSummary result={result} />
      ) : (
        <DocumentSummary />
      )}
      <div className="flex items-center gap-3">
        <CompareRunIndicator />
        <span role="status">상태: {statusText}</span>
        <span className="text-muted-foreground/50">|</span>
        <span>v{__APP_VERSION__}</span>
        <ThirdPartyNoticesButton />
      </div>
    </footer>
  );
}
