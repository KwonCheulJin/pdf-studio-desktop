import { cn } from "@/renderer/shared/lib/utils";

/** 시안 13 동작 줄 버튼: 높이 26px, 좌우 10px, 모서리 6px, 12px */
const BASE_CLASS =
  "focus-visible:ring-ring h-6.5 rounded-sm px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

/** 문단 동작 줄·고치기 입력 칸의 버튼 모양 */
export const PARAGRAPH_BUTTON_CLASS = {
  /** 테두리(다시 번역·직접 고치기·취소) */
  OUTLINE: cn(
    BASE_CLASS,
    "border-border bg-card text-foreground hover:bg-muted border"
  ),
  /** 글자(복사) */
  GHOST: cn(
    BASE_CLASS,
    "text-muted-foreground hover:text-foreground hover:bg-muted"
  ),
  /** 주 동작(저장) */
  PRIMARY: cn(
    BASE_CLASS,
    "bg-primary text-primary-foreground hover:bg-primary/90"
  )
} as const;
