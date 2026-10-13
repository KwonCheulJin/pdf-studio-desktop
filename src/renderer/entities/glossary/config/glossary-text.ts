export const GLOSSARY_TEXT = {
  SOURCE: "원어",
  TARGET: "번역어",
  ADD: "+ 용어 추가",
  REMOVE: "용어 지우기",
  IGNORED_NOTE:
    "빈 칸이 있거나 앞에 같은 원어가 있는 용어(흐리게 표시)는 적용하지 않아요."
} as const;

/** 행마다 다른 접근 가능한 이름(표 안 순번은 1부터) */
export const glossaryText = {
  sourceLabel: (number: number) => `원어 ${number}`,
  targetLabel: (number: number) => `번역어 ${number}`
} as const;
