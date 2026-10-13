import { cn } from "@/renderer/shared/lib/utils";
import type { ValueOf } from "@/renderer/shared/types/common";

export const BADGE_TONE = {
  /** 쪽 배지("B만")·OCR 배지: 옅은 회색 */
  MUTED: "muted",
  /** "확인 필요" */
  REVIEW: "review"
} as const;

type BadgeTone = ValueOf<typeof BADGE_TONE>;

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  [BADGE_TONE.MUTED]: "bg-muted text-foreground",
  [BADGE_TONE.REVIEW]: "bg-warning text-warning-foreground font-medium"
};

interface TextBadgeProps {
  label: string;
  tone: BadgeTone;
  className?: string;
}

/** 목록·캡션의 작은 글자 배지(시안 4 "B만" 배지: 11px, 모서리 4px) */
export function TextBadge({ label, tone, className }: TextBadgeProps) {
  return (
    <span
      className={cn(
        "rounded-xs px-1.5 text-[11px]/4 whitespace-nowrap",
        BADGE_TONE_CLASS[tone],
        className
      )}
    >
      {label}
    </span>
  );
}
