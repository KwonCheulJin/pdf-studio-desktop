import { useId } from "react";
import { CircleAlert } from "lucide-react";
import type { ErrorCode } from "@/renderer/shared/api/bindings";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import { cn } from "@/renderer/shared/lib/utils";
import type { PlatformErrorCode } from "@/renderer/shared/platform";
import { Button } from "@/renderer/shared/ui";
import { TRANSLATE_PROGRESS_TEXT } from "../config/translate-progress";
import { stoppedAtOf } from "../lib/translate-stage-detail";
import { useTranslateSessionStore } from "../model/translate-session-store";
import { useTranslateExecution } from "../model/use-translate-execution";

/** 키를 바꾸면 풀릴 수 있는 실패(계획서 P6-10: 이때만 "키 바꾸기"가 더 있다) */
const API_KEY_ERROR_CODES: readonly PlatformErrorCode[] = [
  "API_KEY_INVALID",
  "API_KEY_MISSING"
] satisfies ErrorCode[];

const ALERT_ICON_SIZE = 18;

/** 버튼(병합 실패 시안 8: 높이 36px, 모서리 8px) */
const DIALOG_BUTTON_CLASS = "h-9 rounded-md px-3.5 font-normal";

interface TranslateFailureCardProps {
  /** "키 바꾸기": 실패를 닫은 뒤 키 모달을 연다(키 모달은 화면이 연다). */
  onChangeApiKey: () => void;
}

/**
 * 번역 실패(계획서 P6-10): 진행 카드 자리에 원인(코드 문구)·멈춘 곳·오류 코드와 "다시 시도(이어서)" / "닫기",
 * 키 오류면 "키 바꾸기". 모양은 병합 실패(시안 8)와 같다.
 */
export function TranslateFailureCard({
  onChangeApiKey
}: TranslateFailureCardProps) {
  const titleId = useId();
  const descriptionId = useId();
  const failure = useTranslateSessionStore((state) => state.failure);
  const closeFailure = useTranslateSessionStore((state) => state.closeFailure);
  const { retryTranslation } = useTranslateExecution();
  if (failure === null) return null;

  // 새 키는 새 계정이라 외부 전송 확인을 다시 받는다(ADR 0002 §13). 그래서 바로 다시 시도하지 않고
  // 옵션 화면으로 돌아가 키 모달을 연다.
  const handleChangeApiKey = () => {
    closeFailure();
    onChangeApiKey();
  };

  return (
    <section
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="bg-card border-border flex w-full max-w-130 flex-col gap-4 self-start rounded-xl border px-7 py-6"
    >
      <div className="flex items-start gap-3.5">
        <span className="bg-destructive-subtle text-destructive flex size-9 shrink-0 items-center justify-center rounded-full">
          <CircleAlert size={ALERT_ICON_SIZE} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={titleId}
            className="text-foreground text-lg/6.5 font-semibold"
          >
            {TRANSLATE_PROGRESS_TEXT.FAILED_TITLE}
          </h2>
          <p
            id={descriptionId}
            className="text-muted-foreground text-sm/5.25 break-words"
          >
            <strong className="text-foreground font-medium">
              {failure.info.fileName}
            </strong>
            {": "}
            {getErrorMessage(failure.code)}
          </p>
        </div>
      </div>
      <dl className="bg-muted text-muted-foreground flex items-center gap-2 rounded-md px-3 py-2.5 text-xs/4.25">
        <div className="flex min-w-0 gap-1">
          <dt>{TRANSLATE_PROGRESS_TEXT.STOPPED_AT}</dt>
          <dd>{stoppedAtOf(failure.progress)}</dd>
        </div>
        <div className="ml-auto flex shrink-0">
          <dt className="sr-only">{TRANSLATE_PROGRESS_TEXT.ERROR_CODE}</dt>
          <dd className="font-mono">{failure.code}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        {API_KEY_ERROR_CODES.includes(failure.code) && (
          <Button
            variant="ghost"
            className={DIALOG_BUTTON_CLASS}
            onClick={handleChangeApiKey}
          >
            {TRANSLATE_PROGRESS_TEXT.CHANGE_KEY}
          </Button>
        )}
        <Button
          variant="outline"
          className={cn(DIALOG_BUTTON_CLASS, "bg-card")}
          onClick={closeFailure}
        >
          {TRANSLATE_PROGRESS_TEXT.CLOSE}
        </Button>
        {/* 실패가 보이면 키보드 포커스를 실패 안으로 옮긴다. */}
        <Button
          autoFocus
          className="h-9 rounded-md px-4 font-medium"
          onClick={() => void retryTranslation()}
        >
          {TRANSLATE_PROGRESS_TEXT.RETRY}
        </Button>
      </div>
    </section>
  );
}
