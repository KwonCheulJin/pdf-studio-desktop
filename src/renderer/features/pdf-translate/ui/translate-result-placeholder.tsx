import { useId } from "react";
import { paragraphCountOf } from "@/renderer/entities/translation";
import { Button } from "@/renderer/shared/ui";
import {
  TRANSLATE_PROGRESS_TEXT,
  translateProgressText
} from "../config/translate-progress";
import { useTranslateSessionStore } from "../model/translate-session-store";

/**
 * 결과 화면(시안 13, Step 46) 자리. 끝난 번역의 문단 수·사용 토큰(기록 누적)과 "옵션으로 돌아가기"만 둔다.
 */
export function TranslateResultPlaceholder() {
  const titleId = useId();
  const result = useTranslateSessionStore((state) => state.result);
  const showOptions = useTranslateSessionStore((state) => state.showOptions);
  if (result === null) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex w-full max-w-190.5 flex-col items-start gap-3 self-start rounded-xl border px-7 py-6"
    >
      <h2 id={titleId} className="text-lg/6.5 font-semibold">
        {TRANSLATE_PROGRESS_TEXT.DONE_TITLE}
      </h2>
      <p className="text-muted-foreground">
        {translateProgressText.doneSummary({
          paragraphs: paragraphCountOf(result),
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens
        })}
      </p>
      <Button
        variant="outline"
        onClick={showOptions}
        className="bg-card h-9 rounded-md px-4 font-normal"
      >
        {TRANSLATE_PROGRESS_TEXT.BACK_TO_OPTIONS}
      </Button>
    </section>
  );
}
