import {
  RECOMMENDED_MODEL_BADGE,
  TRANSLATE_MODEL,
  TRANSLATE_MODEL_INFO,
  TRANSLATE_MODEL_ORDER
} from "@/renderer/entities/translation";
import type { TranslateModel } from "@/renderer/shared/api/bindings";
import type { SegmentedOption } from "@/renderer/shared/ui";

/** 플랫폼 설정 저장소에서 번역 설정을 두는 키(계획서 §9.1.3, ADR 0002 §13) */
export const TRANSLATE_SETTING_KEY = {
  DEFAULT_MODEL: "translate.defaultModel",
  /** 번역 전에 외부 전송 확인을 받을지(Q11) */
  CONFIRM_EXTERNAL_TRANSFER: "translate.confirmExternalTransfer",
  /** 모든 번역에 기본으로 싣는 공용 용어집(`GlossaryTerm[]`, 표에 적힌 그대로) */
  GLOSSARY: "translate.glossary"
} as const;

/** 저장된 값이 없을 때(첫 실행) */
export const DEFAULT_TRANSLATE_SETTINGS = {
  MODEL: TRANSLATE_MODEL.SONNET,
  CONFIRM_EXTERNAL_TRANSFER: true
} as const;

/** 기본 모델 세그먼트(시안 14 `Sonnet 5.5 (권장) | Haiku 5.5`) */
export const MODEL_OPTIONS: readonly SegmentedOption<TranslateModel>[] =
  TRANSLATE_MODEL_ORDER.map((model) => {
    const { name, isRecommended } = TRANSLATE_MODEL_INFO[model];
    return {
      value: model,
      label: isRecommended ? `${name} (${RECOMMENDED_MODEL_BADGE})` : name
    };
  });

export const TRANSLATE_SETTINGS_TEXT = {
  DEFAULT_MODEL: "기본 모델",
  CONFIRM_TRANSFER: "번역 전에 외부 전송 확인 받기",
  CONFIRM_TRANSFER_DESCRIPTION:
    "끄면 실행 전 확인 체크박스를 건너뛰어요. 회사 문서를 다룬다면 켜 두세요.",
  GLOSSARY: "공용 용어집",
  GLOSSARY_APPLIES: "모든 번역에 기본으로 적용",
  GLOSSARY_EDIT: "편집",
  GLOSSARY_EDITOR_DESCRIPTION:
    "여기 적은 용어는 모든 번역에 함께 실려요. 문서마다 정한 용어가 있으면 그것을 먼저 써요.",
  RECORDS: "저장된 번역",
  RECORDS_DESCRIPTION:
    "번역을 이어서 하거나 다시 볼 수 있게 이 컴퓨터에 남겨 둔 번역이에요.",
  RECORDS_CLEAR: "모두 지우기",
  RECORDS_CLEAR_CONFIRM: "저장된 번역을 모두 지울까요?",
  RECORDS_CLEAR_ACTION: "지우기",
  RECORDS_CLEARED: "저장된 번역을 모두 지웠어요.",
  RECORDS_CLEAR_FAILED: "저장된 번역을 지우지 못했어요.",
  CANCEL: "취소"
} as const;

export const translateSettingsText = {
  glossaryCount: (count: number) => `용어 ${count}개`
} as const;
