import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";
import type {
  TranslateOptions,
  TranslationPlan
} from "@/renderer/shared/api/bindings";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import {
  getPlatform,
  LOG_LEVEL,
  toPlatformError,
  type PlatformErrorCode
} from "@/renderer/shared/platform";
import { TRANSLATE_OPTIONS_TEXT } from "../config/translate-options";
import { translateRangeErrorOf } from "../lib/translate-range";
import { useTranslateSessionStore } from "./translate-session-store";

export const PLAN_STATUS = {
  /** 문서가 없거나 쪽 범위가 틀려 계획을 받지 않는다. */
  NONE: "none",
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed"
} as const;

export type TranslationPlanState =
  | { status: typeof PLAN_STATUS.NONE }
  | { status: typeof PLAN_STATUS.LOADING }
  | { status: typeof PLAN_STATUS.READY; plan: TranslationPlan }
  | { status: typeof PLAN_STATUS.FAILED; errorCode: PlatformErrorCode };

const NONE: TranslationPlanState = { status: PLAN_STATUS.NONE };
const LOADING: TranslationPlanState = { status: PLAN_STATUS.LOADING };

interface PlanRequest {
  key: string;
  path: string;
  options: TranslateOptions;
}

/**
 * 실행 전 확인의 계획(`prepareTranslation`, 네트워크 없음)을 옵션이 바뀔 때마다 다시 받는다.
 * 마지막으로 보낸 요청의 응답만 쓰고(늦게 온 앞 응답은 버린다), 받는 동안은 `loading`이다.
 * 번역 화면에서 한 번만 부른다.
 */
export function useTranslationPlan(
  options: TranslateOptions
): TranslationPlanState {
  const file = useTranslateSessionStore((state) => state.file);
  const revision = useTranslateSessionStore((state) => state.planRevision);
  const entry = useTranslateSessionStore((state) => state.plan);
  const receivePlan = useTranslateSessionStore((state) => state.receivePlan);
  /** 마지막으로 보낸 요청 키. 응답이 왔을 때 다르면 그 뒤에 옵션이 바뀐 것이다. */
  const latestKeyRef = useRef<string | null>(null);

  const rangeError = translateRangeErrorOf({ file, range: options.range });
  const request: PlanRequest | null =
    file === null || rangeError !== null
      ? null
      : {
          key: JSON.stringify({ revision, path: file.path, options }),
          path: file.path,
          options
        };
  const requestKey = request?.key ?? null;

  const requestPlan = useEffectEvent(() => {
    if (request === null) return;
    // 받았거나 받는 중인 요청은 다시 보내지 않는다.
    if (useTranslateSessionStore.getState().plan?.key === request.key) return;
    if (latestKeyRef.current === request.key) return;
    const { key, path } = request;
    latestKeyRef.current = key;
    getPlatform()
      .prepareTranslation({ path, options: request.options })
      .then(
        (plan) => {
          if (latestKeyRef.current !== key) return;
          receivePlan({ key, path, plan, errorCode: null });
        },
        (error: unknown) => {
          if (latestKeyRef.current !== key) return;
          const platformError = toPlatformError(error);
          getPlatform().log({
            level: LOG_LEVEL.ERROR,
            message: `번역 계획 실패: [${platformError.code}] ${platformError.message}`
          });
          toast.error(TRANSLATE_OPTIONS_TEXT.PLAN_FAILED_TITLE, {
            description: getErrorMessage(platformError.code)
          });
          receivePlan({
            key,
            path,
            plan: null,
            errorCode: platformError.code
          });
        }
      );
  });

  // 계획은 Rust가 문서를 읽어 세운다(외부 시스템). 키(문서·옵션·다시 받기 번호)가 바뀔 때만 다시 묻는다.
  useEffect(() => {
    requestPlan();
  }, [requestKey]);

  if (request === null) return NONE;
  if (entry?.key !== request.key) return LOADING;
  if (entry.plan !== null) {
    return { status: PLAN_STATUS.READY, plan: entry.plan };
  }
  return entry.errorCode === null
    ? LOADING
    : { status: PLAN_STATUS.FAILED, errorCode: entry.errorCode };
}
