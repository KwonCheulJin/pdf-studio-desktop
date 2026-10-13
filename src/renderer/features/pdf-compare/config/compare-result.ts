import type { ValueOf } from "@/renderer/shared/types/common";

/** 결과 화면 보기 방식(계획서 P3-4 `나란히 | A만 | B만`) */
export const COMPARE_VIEW_MODE = {
  SIDE_BY_SIDE: "sideBySide",
  BEFORE_ONLY: "beforeOnly",
  AFTER_ONLY: "afterOnly"
} as const;

export type CompareViewMode = ValueOf<typeof COMPARE_VIEW_MODE>;

export const COMPARE_VIEW_MODES: readonly CompareViewMode[] = [
  COMPARE_VIEW_MODE.SIDE_BY_SIDE,
  COMPARE_VIEW_MODE.BEFORE_ONLY,
  COMPARE_VIEW_MODE.AFTER_ONLY
];

export const COMPARE_VIEW_MODE_LABEL: Record<CompareViewMode, string> = {
  [COMPARE_VIEW_MODE.SIDE_BY_SIDE]: "나란히",
  [COMPARE_VIEW_MODE.BEFORE_ONLY]: "A만",
  [COMPARE_VIEW_MODE.AFTER_ONLY]: "B만"
};

/** 결과 화면 문구(시안 4) */
export const COMPARE_RESULT_TEXT = {
  BACK_TO_OPTIONS: "옵션으로 돌아가기",
  NEW_COMPARE: "새 비교",
  EXPORT: "내보내기",
  MORE: "더 보기",
  RERUN: "다시 실행",
  RECENT_RESULT: "최근 결과",
  KIND_FILTER: "차이 종류",
  PREVIOUS: "이전",
  NEXT: "다음",
  POSITION: "차이 위치",
  VIEW_MODE: "보기 방식",
  CHANGE_LIST: "차이 목록",
  GROUP_BY_PAGE: "쪽별로 묶기",
  COLLAPSE_LIST: "목록 접기",
  EXPAND_LIST: "목록 펼치기",
  NO_CHANGES_TITLE: "차이가 없어요",
  NO_CHANGES_DESCRIPTION: "두 문서의 글자가 같아요.",
  ALL_HIDDEN_TITLE: "모든 차이를 숨겼어요",
  RESET_FILTER: "필터 초기화",
  NOTICES: "비교 안내",
  NOTICES_MORE: "자세히",
  NOTICES_LESS: "접기",
  BEFORE_CHANGE: "변경 전",
  AFTER_CHANGE: "변경 후",
  STATUS_DONE: "완료"
} as const;

/** 위치 표시에서 고른 변경이 없거나 숨겨졌을 때 */
export const NO_POSITION_TEXT = "–";

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

interface ChipTextParams {
  label: string;
  count: number;
}

/** 숫자가 들어가는 결과 화면 문구 */
export const compareResultMessage = {
  /** "1.8초 만에 완료", 1분이 넘으면 "1분 12초 만에 완료" */
  elapsed: (elapsedMs: number) => {
    const seconds = elapsedMs / MILLISECONDS_PER_SECOND;
    if (seconds < SECONDS_PER_MINUTE) {
      return `${seconds.toFixed(1)}초 만에 완료`;
    }
    const wholeSeconds = Math.floor(seconds);
    return `${Math.floor(wholeSeconds / SECONDS_PER_MINUTE)}분 ${wholeSeconds % SECONDS_PER_MINUTE}초 만에 완료`;
  },
  differences: (count: number) => `차이 ${count}건`,
  review: (count: number) => `확인 필요 ${count}건`,
  hidden: (count: number) => `${count}개 숨김`,
  notices: (count: number) => `안내 ${count}건`,
  /** 칩 글자 "추가 12" */
  chip: ({ label, count }: ChipTextParams) => `${label} ${count}`
} as const;
