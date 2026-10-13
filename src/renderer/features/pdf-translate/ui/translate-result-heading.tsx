import { ChevronLeft } from "lucide-react";
import {
  DETECTED_LANGUAGE,
  DETECTED_LANGUAGE_LABEL,
  rangePageCountOf,
  TARGET_LANGUAGE_LABEL,
  TRANSLATE_MODEL_INFO
} from "@/renderer/entities/translation";
import type { TranslationResult } from "@/renderer/shared/api/bindings";
import { Button } from "@/renderer/shared/ui";
import { translateProgressText } from "../config/translate-progress";
import {
  TRANSLATE_RESULT_TEXT,
  translateResultText
} from "../config/translate-result";
import {
  useTranslateFile,
  useTranslateResult,
  useTranslateSessionStore
} from "../model/translate-session-store";

const BACK_ICON_SIZE = 18;

const EXTENSION_PATTERN = /\.[^./\\]+$/;

/** 머리 아래 줄: 언어(모름이면 뺀다) · 모델 · 범위 쪽 수 · 걸린 시간 */
function detailsOf(result: TranslationResult): string {
  const language =
    result.language === DETECTED_LANGUAGE.UNKNOWN
      ? null
      : translateProgressText.languages({
          source: DETECTED_LANGUAGE_LABEL[result.language],
          target: TARGET_LANGUAGE_LABEL
        });
  return translateResultText.details(
    [
      language,
      TRANSLATE_MODEL_INFO[result.model].name,
      translateResultText.pages(rangePageCountOf(result)),
      translateResultText.elapsed(result.elapsedMs)
    ].filter((part) => part !== null)
  );
}

/**
 * 결과 화면 머리(시안 13, 모드 탭 오른쪽): 뒤로(옵션 화면), 제목 `<파일 이름> · 한국어`, 언어·모델·쪽·걸린 시간,
 * "새 번역". 시안의 "내보내기"는 두지 않는다(계획서 §9.1.9 Q1 기능 없음).
 */
export function TranslateResultHeading() {
  const file = useTranslateFile();
  const result = useTranslateResult();
  const showOptions = useTranslateSessionStore((state) => state.showOptions);
  const startNewTranslation = useTranslateSessionStore(
    (state) => state.startNewTranslation
  );
  if (file === null || result === null) return null;

  return (
    <>
      <button
        type="button"
        aria-label={TRANSLATE_RESULT_TEXT.BACK_TO_OPTIONS}
        onClick={showOptions}
        className="hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronLeft size={BACK_ICON_SIZE} aria-hidden="true" />
      </button>
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-[15px]/5.5 font-semibold">
          {translateResultText.title({
            baseName: file.name.replace(EXTENSION_PATTERN, ""),
            target: TARGET_LANGUAGE_LABEL
          })}
        </h1>
        <span className="text-muted-foreground text-xs/4">
          {detailsOf(result)}
        </span>
      </div>
      <span className="grow" />
      <Button
        variant="outline"
        onClick={startNewTranslation}
        className="border-primary text-primary bg-card h-9 rounded-md px-3.5 font-normal"
      >
        {TRANSLATE_RESULT_TEXT.NEW_TRANSLATION}
      </Button>
    </>
  );
}
