/** 결과 화면(Step 27)이 들어오기 전의 자리표시 문구 */
export const COMPARE_RESULT_TEXT = {
  TITLE: "비교를 마쳤어요",
  PREVIEW_PENDING: "결과 미리보기 화면은 준비 중이에요.",
  BACK_TO_OPTIONS: "옵션으로 돌아가기"
} as const;

interface ChangeCounts {
  differences: number;
  needsReview: number;
}

/** "차이 3개 · 확인 필요 1개"(확인 필요는 차이 개수에 넣지 않는다, ADR 0001 §5) */
export const compareResultMessage = {
  counts: ({ differences, needsReview }: ChangeCounts) =>
    `차이 ${differences}개 · 확인 필요 ${needsReview}개`
} as const;
