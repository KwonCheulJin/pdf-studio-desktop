import type { ValueOf } from "@/renderer/shared/types/common";

export const SELECTION_MODE = {
  NONE: "none",
  SINGLE: "single",
  MULTIPLE: "multiple"
} as const;

export type SelectionMode = ValueOf<typeof SELECTION_MODE>;
