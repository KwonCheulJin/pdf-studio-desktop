import { useMemo } from "react";
import {
  normalizeGlossary,
  toGlossaryTerms,
  type GlossaryRow
} from "@/renderer/entities/glossary";
import type {
  TranslateModel,
  TranslateOptions
} from "@/renderer/shared/api/bindings";
import { useTranslateSessionOptions } from "./translate-session-store";

export interface TranslateSettingsInput {
  /** 설정의 기본 모델(옵션에서 고르지 않았으면 이것) */
  defaultModel: TranslateModel;
  /** 설정의 공용 용어집 표(적힌 그대로) */
  sharedGlossaryRows: readonly GlossaryRow[];
}

/**
 * 계획·번역 요청에 싣는 옵션. 용어집은 문서별 용어를 앞에 두고 공용 용어를 합쳐 정규화한다
 * (같은 원어면 문서별이 이긴다, ADR 0002 §10).
 */
export function useTranslateRequestOptions({
  defaultModel,
  sharedGlossaryRows
}: TranslateSettingsInput): TranslateOptions {
  const options = useTranslateSessionOptions();
  return useMemo(
    () => ({
      sourceLanguage: options.sourceLanguage,
      range: options.range,
      includeScanPages: options.includeScanPages,
      model: options.model ?? defaultModel,
      glossary: normalizeGlossary([
        ...toGlossaryTerms(options.glossaryRows),
        ...toGlossaryTerms(sharedGlossaryRows)
      ])
    }),
    [options, defaultModel, sharedGlossaryRows]
  );
}
