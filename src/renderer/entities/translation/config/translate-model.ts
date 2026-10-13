import type { TranslateModel } from "@/renderer/shared/api/bindings";

/** 번역 모델(계약 값). API ID·요금은 crates/translate 모델 표에만 있다. */
export const TRANSLATE_MODEL = {
  SONNET: "sonnet",
  HAIKU: "haiku"
} as const satisfies Record<string, TranslateModel>;

/** 화면에 보이는 순서(권장 모델 먼저) */
export const TRANSLATE_MODEL_ORDER: readonly TranslateModel[] = [
  TRANSLATE_MODEL.SONNET,
  TRANSLATE_MODEL.HAIKU
];

export interface TranslateModelInfo {
  /** 표시 이름(시안 10·12·13·14) */
  name: string;
  /** 옵션 화면 모델 카드 설명(시안 10) */
  description: string;
  isRecommended: boolean;
}

export const TRANSLATE_MODEL_INFO: Record<TranslateModel, TranslateModelInfo> =
  {
    [TRANSLATE_MODEL.SONNET]: {
      name: "Sonnet 5.5",
      description: "문서 번역 품질과 비용의 균형",
      isRecommended: true
    },
    [TRANSLATE_MODEL.HAIKU]: {
      name: "Haiku 5.5",
      description: "빠르고 저렴, 초벌 번역용",
      isRecommended: false
    }
  };

/** 권장 모델 배지(시안 10 모델 카드) */
export const RECOMMENDED_MODEL_BADGE = "권장";
