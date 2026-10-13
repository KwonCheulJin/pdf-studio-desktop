import {
  baseSourceLanguageOf,
  SOURCE_LANGUAGE,
  SOURCE_LANGUAGE_LABEL,
  TARGET_LANGUAGE_LABEL
} from "@/renderer/entities/translation";
import {
  useTranslateFile,
  useTranslateFilePlan,
  useTranslateSessionOptions
} from "@/renderer/features/pdf-translate";
import { ThirdPartyNoticesButton } from "@/renderer/features/third-party-notices";
import { APP_STATUS } from "@/renderer/shared/constants";
import { CompareRunIndicator } from "./compare-run-indicator";

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

/**
 * 번역 화면 상태바(시안 10): 왼쪽에 쪽수(파일이 없으면 "비어 있음")와 `중국어 → 한국어`(원문 언어를 알 때),
 * 오른쪽에 상태·버전
 */
export function AppTranslateStatusBar() {
  const file = useTranslateFile();
  const sourceLanguageName = useSourceLanguageName();
  return (
    <footer className="border-border bg-background text-muted-foreground flex h-10 shrink-0 items-center justify-between gap-4 border-t px-6 text-sm">
      <span>
        {file ? `${file.pageCount}쪽` : EMPTY_FILE_TEXT}
        {file && sourceLanguageName && (
          <>
            <span className="mx-2">|</span>
            {`${sourceLanguageName} → ${TARGET_LANGUAGE_LABEL}`}
          </>
        )}
      </span>
      <div className="flex items-center gap-3">
        <CompareRunIndicator />
        <span>상태: {APP_STATUS.READY}</span>
        <span className="text-muted-foreground/50">|</span>
        <span>v{__APP_VERSION__}</span>
        <ThirdPartyNoticesButton />
      </div>
    </footer>
  );
}
