import { useEffect, useRef } from "react";
import {
  BADGE_TONE,
  CHANGE_KIND_LABEL,
  CHANGE_SIDE_LABEL,
  changeSummary,
  ChangeSwatch,
  COMPARE_SIDE,
  COMPARE_SIDE_BADGE,
  COMPARE_SIDES,
  COMPARISON_TEXT,
  changeSideOf,
  displayPageNumber,
  TextBadge,
  type Change,
  type NumberedChange,
  type Side
} from "@/renderer/entities/comparison";
import { cn } from "@/renderer/shared/lib/utils";
import { COMPARE_RESULT_TEXT } from "../config/compare-result";

/** 펼친 상자의 글자: A 쪽은 삭제(취소선), B 쪽은 추가(밑줄) 모양(시안 4, 토큰 문서 §2.1) */
const DETAIL_TEXT_CLASS: Record<Side, string> = {
  [COMPARE_SIDE.BEFORE]:
    "bg-diff-delete-fill decoration-diff-delete line-through",
  [COMPARE_SIDE.AFTER]:
    "bg-diff-insert-fill decoration-diff-insert underline decoration-2"
};

const DETAIL_CAPTION: Record<Side, string> = {
  [COMPARE_SIDE.BEFORE]: COMPARE_RESULT_TEXT.BEFORE_CHANGE,
  [COMPARE_SIDE.AFTER]: COMPARE_RESULT_TEXT.AFTER_CHANGE
};

interface ChangeDetailProps {
  change: Change;
}

/** 고른 변경의 전/후 상자. 조항 문맥은 결과 모델에 없어 바뀐 글자만 보인다. */
function ChangeDetail({ change }: ChangeDetailProps) {
  return (
    <span className="mt-1 grid gap-1.5">
      {COMPARE_SIDES.map((side) => {
        const changeSide = changeSideOf({ change, side });
        if (!changeSide) return null;
        const page = displayPageNumber(changeSide.boxes[0].page);
        return (
          <span
            key={side}
            className="bg-card border-border block rounded-sm border p-2 text-xs/4.5"
          >
            <span className="text-muted-foreground block text-[11px]">
              {COMPARE_SIDE_BADGE[side]} {DETAIL_CAPTION[side]} · {page}쪽
            </span>
            <span className={DETAIL_TEXT_CLASS[side]}>{changeSide.text}</span>
          </span>
        );
      })}
    </span>
  );
}

interface ChangeListItemProps {
  numbered: NumberedChange;
  isActive: boolean;
  /** 이 변경이 든 연결선에 마우스가 있다(계획서 §7.1 호버 강조) */
  isHovered: boolean;
  onSelect: (changeId: string) => void;
}

/**
 * 차이 목록 항목(시안 4): 견본 · 종류 · 쪽 배지 · `#번호` · 한 줄 요약. 고른 항목은 `accent` 바탕과
 * 왼쪽 primary 띠, 전/후 상자로 펼친다. 고르면(키보드 이동 포함) 목록 안에서 보이게 스크롤한다.
 * 이 변경이 든 연결선을 가리키면 마우스를 올린 것과 같은 `muted` 바탕이다.
 */
export function ChangeListItem({
  numbered,
  isActive,
  isHovered,
  onSelect
}: ChangeListItemProps) {
  const { change, number } = numbered;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const summary = changeSummary(change);
  const label = `#${number} ${CHANGE_KIND_LABEL[change.kind]} ${CHANGE_SIDE_LABEL[change.kind]}: ${summary}${
    change.needsReview ? ` · ${COMPARISON_TEXT.NEEDS_REVIEW}` : ""
  }`;

  useEffect(() => {
    if (isActive) {
      buttonRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isActive]);

  return (
    <li>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-current={isActive ? true : undefined}
        data-hovered={isHovered || undefined}
        onClick={() => onSelect(change.id)}
        className={cn(
          "focus-visible:ring-ring relative flex w-full gap-2.5 rounded-md p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
          isActive
            ? "bg-accent before:bg-primary before:absolute before:inset-y-0 before:left-0 before:w-0.75 before:rounded-l-md"
            : "hover:bg-muted data-hovered:bg-muted"
        )}
      >
        <ChangeSwatch kind={change.kind} className="mt-1.25" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs/4">
            <b className="font-semibold">{CHANGE_KIND_LABEL[change.kind]}</b>
            <TextBadge
              label={CHANGE_SIDE_LABEL[change.kind]}
              tone={BADGE_TONE.MUTED}
            />
            <span className="text-muted-foreground font-mono text-[11px]">
              #{number}
            </span>
            {change.needsReview && (
              <TextBadge
                label={COMPARISON_TEXT.NEEDS_REVIEW}
                tone={BADGE_TONE.REVIEW}
              />
            )}
          </span>
          <span className="truncate text-[13px]/4.75">{summary}</span>
          {isActive && <ChangeDetail change={change} />}
        </span>
      </button>
    </li>
  );
}
