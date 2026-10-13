import type { ValueOf } from "@/renderer/shared/types/common";

/** 홈의 작업 카드. 번역 카드는 Phase 6(계획서 §9.1)에서 더한다. */
export const HOME_CARD = {
  MERGE: "merge",
  COMPARE: "compare"
} as const;

export type HomeCard = ValueOf<typeof HOME_CARD>;

export const HOME_CARDS: readonly HomeCard[] = Object.values(HOME_CARD);
