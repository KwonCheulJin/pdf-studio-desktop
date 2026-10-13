import type { ValueOf } from "@/renderer/shared/types/common";

/** 홈의 작업 카드 */
export const HOME_CARD = {
  MERGE: "merge",
  COMPARE: "compare",
  TRANSLATE: "translate"
} as const;

export type HomeCard = ValueOf<typeof HOME_CARD>;

export const HOME_CARDS: readonly HomeCard[] = Object.values(HOME_CARD);
