import { useId } from "react";
import { Check } from "lucide-react";
import { Button } from "@/renderer/shared/ui";
import {
  COMPARE_RESULT_TEXT,
  compareResultMessage
} from "../config/compare-result";
import { useCompareSessionStore } from "../model/compare-session-store";

const CHECK_ICON_SIZE = 20;

/**
 * 비교가 끝나면 보이는 자리표시. 결과(`CompareResult`)는 세션에 두고, 결과 미리보기 화면(계획서 P3-4)은
 * Step 27에서 이 자리에 들어온다. 지금은 차이·확인 필요 개수와 옵션으로 돌아가기만 보인다.
 */
export function CompareResultPlaceholder() {
  const titleId = useId();
  const result = useCompareSessionStore((state) => state.result);
  const showOptions = useCompareSessionStore((state) => state.showOptions);
  const changes = result?.changes ?? [];
  const needsReview = changes.filter((change) => change.needsReview).length;

  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex w-full max-w-190.5 flex-col items-center gap-3 self-start rounded-xl border px-7 py-10 text-center"
    >
      <span className="bg-success-subtle text-success-subtle-foreground flex size-10 items-center justify-center rounded-full">
        <Check size={CHECK_ICON_SIZE} aria-hidden="true" />
      </span>
      <h2 id={titleId} className="text-lg/6.5 font-semibold">
        {COMPARE_RESULT_TEXT.TITLE}
      </h2>
      <p className="text-foreground">
        {compareResultMessage.counts({
          differences: changes.length - needsReview,
          needsReview
        })}
      </p>
      <p className="text-muted-foreground text-xs/4.25">
        {COMPARE_RESULT_TEXT.PREVIEW_PENDING}
      </p>
      <Button
        variant="outline"
        onClick={showOptions}
        className="bg-card h-9 rounded-md px-4 font-normal"
      >
        {COMPARE_RESULT_TEXT.BACK_TO_OPTIONS}
      </Button>
    </section>
  );
}
