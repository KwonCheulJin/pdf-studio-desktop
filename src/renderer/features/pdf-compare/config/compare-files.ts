/** 한 번에 비교하는 문서 수(A 이전 · B 이후) */
export const COMPARE_FILE_COUNT = 2;

export const COMPARE_INTAKE_MESSAGE = {
  TOO_MANY_TITLE: "비교할 파일은 2개까지 넣을 수 있어요.",
  TOO_MANY_DESCRIPTION: "이전 문서와 이후 문서를 하나씩 골라 주세요.",
  PICK_FAILED_TITLE: "비교할 파일을 고르지 못했습니다."
} as const;
