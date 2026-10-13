import { toast } from "sonner";
import { isUntranslatedParagraph } from "@/renderer/entities/translation";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError,
  type PlatformErrorCode
} from "@/renderer/shared/platform";
import { PARAGRAPH_ACTION_TEXT } from "../config/translate-result";
import { useTranslateSessionStore } from "./translate-session-store";

interface FailureLogParams {
  action: string;
  error: unknown;
}

/** 실패를 로그에 남기고 코드를 돌려준다(토스트 설명에 쓴다). */
function logFailure({ action, error }: FailureLogParams): PlatformErrorCode {
  const platformError = toPlatformError(error);
  getPlatform().log({
    level: LOG_LEVEL.ERROR,
    message: `${action} 실패: [${platformError.code}] ${platformError.message}`
  });
  return platformError.code;
}

/**
 * 문단 하나를 앞뒤 문맥과 함께 다시 번역한다(계획서 P6-12). 한 번에 하나만 하고, 번역이 도는 동안에는 하지
 * 않는다(Rust도 `JOB_ALREADY_RUNNING`). 끝나면 글을 바꾸고 사용량을 더한다. 실패·거절로 오거나 오류면 토스트로
 * 알리고 원래 글을 둔다.
 */
export async function retranslateParagraph(key: string): Promise<void> {
  const session = useTranslateSessionStore.getState();
  const { result, resultRequest } = session;
  if (
    result === null ||
    resultRequest === null ||
    session.run !== null ||
    session.retranslation !== null
  ) {
    return;
  }
  const jobId = crypto.randomUUID();
  session.startRetranslation({ jobId, key });
  try {
    const retranslated = await getPlatform().retranslateParagraph({
      jobId,
      recordId: result.recordId,
      path: resultRequest.path,
      key,
      options: resultRequest.options
    });
    useTranslateSessionStore.getState().finishRetranslation({
      jobId,
      recordId: result.recordId,
      retranslated
    });
    const { paragraph } = retranslated;
    if (isUntranslatedParagraph(paragraph)) {
      toast.error(PARAGRAPH_ACTION_TEXT.RETRANSLATE_FAILED, {
        description:
          paragraph.failCode === null
            ? undefined
            : getErrorMessage(paragraph.failCode)
      });
    }
  } catch (error) {
    useTranslateSessionStore.getState().abortRetranslation(jobId);
    const code = logFailure({ action: `문단 다시 번역 ${key}`, error });
    toast.error(PARAGRAPH_ACTION_TEXT.RETRANSLATE_FAILED, {
      description: getErrorMessage(code)
    });
  }
}

interface EditParagraphParams {
  key: string;
  text: string;
}

/**
 * 직접 고친 글을 기록에 쓰고 결과 문단을 바꾼다. 빈 글이면 원래 번역으로 돌아간다(Rust 규칙). 저장했으면 `true`,
 * 실패하면 토스트로 알리고 `false`(입력 칸을 그대로 둔다).
 */
export async function editParagraph({
  key,
  text
}: EditParagraphParams): Promise<boolean> {
  const { result, resultRequest } = useTranslateSessionStore.getState();
  if (result === null || resultRequest === null) return false;
  try {
    const paragraph = await getPlatform().editTranslatedParagraph({
      recordId: result.recordId,
      path: resultRequest.path,
      key,
      text,
      options: resultRequest.options
    });
    useTranslateSessionStore
      .getState()
      .replaceResultParagraph({ recordId: result.recordId, paragraph });
    return true;
  } catch (error) {
    const code = logFailure({ action: `문단 고치기 ${key}`, error });
    toast.error(PARAGRAPH_ACTION_TEXT.EDIT_FAILED, {
      description: getErrorMessage(code)
    });
    return false;
  }
}

/** 문단 번역 글을 클립보드에 복사하고 토스트로 알린다. */
export async function copyParagraphText(text: string): Promise<void> {
  try {
    await getPlatform().copyText(text);
    toast.success(PARAGRAPH_ACTION_TEXT.COPIED);
  } catch (error) {
    const code = logFailure({ action: "문단 복사", error });
    toast.error(PARAGRAPH_ACTION_TEXT.COPY_FAILED, {
      description: getErrorMessage(code)
    });
  }
}
