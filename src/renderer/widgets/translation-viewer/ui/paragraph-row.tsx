import { useEffect, useRef, useState } from "react";
import {
  ParagraphActions,
  ParagraphEditor
} from "@/renderer/features/pdf-translate";
import {
  isUntranslatedParagraph,
  PARAGRAPH_STATUS
} from "@/renderer/entities/translation";
import type { TranslatedParagraph } from "@/renderer/shared/api/bindings";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import { cn } from "@/renderer/shared/lib/utils";
import { PANEL_SIDE, VIEWER_TEXT, type PanelSide } from "../config/viewer";

interface ParagraphTextProps {
  paragraph: TranslatedParagraph;
  side: PanelSide;
}

/** 원문은 원문 글, 번역은 번역 글(고친 글이면 "고침" 배지), 실패·거절이면 이유 문구 */
function ParagraphText({ paragraph, side }: ParagraphTextProps) {
  const weightClass = paragraph.heading ? "font-semibold" : undefined;
  if (side === PANEL_SIDE.SOURCE) {
    return <span className={weightClass}>{paragraph.source}</span>;
  }
  if (isUntranslatedParagraph(paragraph)) {
    return (
      <span className="text-destructive">
        {paragraph.failCode === null
          ? null
          : getErrorMessage(paragraph.failCode)}
      </span>
    );
  }
  return (
    <>
      <span className={weightClass}>{paragraph.target}</span>
      {paragraph.status === PARAGRAPH_STATUS.EDITED && (
        <span className="bg-secondary text-secondary-foreground ml-2 inline-block rounded-xs px-1.5 align-middle text-[11px]/4 font-medium">
          {VIEWER_TEXT.EDITED}
        </span>
      )}
    </>
  );
}

interface TargetContentProps {
  paragraph: TranslatedParagraph;
  isActive: boolean;
}

/**
 * 번역 쪽 행 내용: 글 + 동작 줄(고른 문단, 실패·거절 문단은 다시 번역만, 계획서 P6-12). "직접 고치기"를 누르면
 * 글 자리가 입력 칸이 된다. 행 높이가 바뀌어도 두 패널이 서브그리드 행을 함께 써서 같은 번호 행이 맞는다.
 */
function TargetContent({ paragraph, isActive }: TargetContentProps) {
  const [isEditing, setIsEditing] = useState(false);
  if (isEditing) {
    return (
      <ParagraphEditor
        paragraph={paragraph}
        onClose={() => setIsEditing(false)}
      />
    );
  }
  return (
    <>
      <ParagraphText paragraph={paragraph} side={PANEL_SIDE.TARGET} />
      <ParagraphActions
        paragraph={paragraph}
        isActive={isActive}
        onEdit={() => setIsEditing(true)}
      />
    </>
  );
}

interface ParagraphRowProps {
  paragraph: TranslatedParagraph;
  side: PanelSide;
  isActive: boolean;
  onSelect: (key: string) => void;
}

/**
 * 문단 한 행(시안 13): 번호(쪽 안 순번) + 글(번역 쪽은 동작 줄과 함께). 누르면 고르고, 고른 행은 양쪽 `accent` 바탕에 번역 쪽만 왼쪽 3px
 * `primary` 막대다. 키보드로 고르면 화면 밖 행으로 스크롤이 따라간다.
 */
export function ParagraphRow({
  paragraph,
  side,
  isActive,
  onSelect
}: ParagraphRowProps) {
  const rowRef = useRef<HTMLLIElement>(null);

  // 고른 행이 화면 밖이면 보이게 스크롤한다(↑↓로 고를 때. 누른 행은 이미 보여 움직이지 않는다).
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isActive]);

  return (
    <li
      ref={rowRef}
      aria-current={isActive ? "true" : undefined}
      data-paragraph-key={paragraph.key}
      onClick={() => onSelect(paragraph.key)}
      className={cn(
        "relative cursor-pointer rounded-xs py-1.5 pr-2 pl-7.5 break-words",
        isActive ? "bg-accent" : "hover:bg-muted"
      )}
    >
      {isActive && side === PANEL_SIDE.TARGET && (
        <span
          aria-hidden="true"
          className="bg-primary absolute inset-y-0 left-0 w-0.75 rounded-l-xs"
        />
      )}
      <span className="text-muted-foreground absolute top-2 left-1.5 font-mono text-[10px]/3.5">
        {paragraph.number}
      </span>
      {side === PANEL_SIDE.TARGET ? (
        <TargetContent paragraph={paragraph} isActive={isActive} />
      ) : (
        <ParagraphText paragraph={paragraph} side={side} />
      )}
    </li>
  );
}
