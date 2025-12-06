import type { ValueOf } from "../types/common";

/**
 * FlatCard 타입 상수
 */
export const FLAT_CARD_TYPE = {
  FILE: "file",
  PAGE: "page"
} as const;

export type FlatCardType = ValueOf<typeof FLAT_CARD_TYPE>;
