import type { ValueOf } from "@/renderer/shared/types/common";

/** 한 번에 비교하는 문서 수(A 이전 · B 이후) */
export const COMPARE_FILE_COUNT = 2;

/** 비교 세션의 슬롯. 값은 세션 스토어의 필드 이름이다. */
export const COMPARE_SLOT = {
  BEFORE: "before",
  AFTER: "after"
} as const;

export type CompareSlot = ValueOf<typeof COMPARE_SLOT>;

/** A → B 순서. 빈 슬롯을 채우는 순서이자 두 파일을 받았을 때 넣는 순서다. */
export const COMPARE_SLOTS: readonly CompareSlot[] = [
  COMPARE_SLOT.BEFORE,
  COMPARE_SLOT.AFTER
];

interface CompareSlotLabel {
  /** 슬롯 머리의 글자 배지 */
  badge: string;
  title: string;
}

export const COMPARE_SLOT_LABEL: Record<CompareSlot, CompareSlotLabel> = {
  [COMPARE_SLOT.BEFORE]: { badge: "A", title: "이전 문서" },
  [COMPARE_SLOT.AFTER]: { badge: "B", title: "이후 문서" }
};

export const COMPARE_INTAKE_MESSAGE = {
  TOO_MANY_TITLE: "비교할 파일은 2개까지 넣을 수 있어요.",
  TOO_MANY_DESCRIPTION: "이전 문서와 이후 문서를 하나씩 골라 주세요.",
  PICK_FAILED_TITLE: "비교할 파일을 고르지 못했습니다.",
  OPEN_FAILED_TITLE: "비교할 파일을 열지 못했어요.",
  SLOTS_FULL_TITLE: "두 슬롯이 모두 차 있어요.",
  SLOTS_FULL_DESCRIPTION: "바꿀 슬롯 위에 놓아 주세요.",
  NOT_PDF_DESCRIPTION:
    "PDF만 비교할 수 있어요. TIFF는 병합에서 PDF로 저장한 뒤 넣어 주세요."
} as const;

/** 파일 이름이 들어가는 알림 제목 */
export const compareFileMessage = {
  notPdfTitle: (fileName: string) => `"${fileName}" 파일은 비교할 수 없어요.`,
  openFailedTitle: (fileName: string) => `"${fileName}" 파일을 열 수 없어요.`
} as const;
