import { Loader2 } from "lucide-react";
import { isUntranslatedParagraph } from "@/renderer/entities/translation";
import type { TranslatedParagraph } from "@/renderer/shared/api/bindings";
import { cn } from "@/renderer/shared/lib/utils";
import { PARAGRAPH_ACTION_TEXT } from "../config/translate-result";
import {
  copyParagraphText,
  retranslateParagraph
} from "../model/paragraph-actions";
import { useRetranslatingParagraphKey } from "../model/translate-session-store";
import { PARAGRAPH_BUTTON_CLASS } from "./paragraph-button-class";

const SPINNER_SIZE = 14;

/** 동작 줄 자리(글 아래 8px, 버튼 사이 6px) */
const ACTION_ROW_CLASS = "mt-2 flex flex-wrap items-center gap-1.5";

interface ParagraphActionsProps {
  paragraph: TranslatedParagraph;
  /** 고른 문단이면 동작 줄 전체, 아니면 실패·거절 문단의 "이 문단 다시 번역"만 */
  isActive: boolean;
  /** "직접 고치기": 번역 자리를 입력 칸으로 바꾼다(위젯이 `ParagraphEditor`를 둔다). */
  onEdit: () => void;
}

/**
 * 번역 문단 아래 동작 줄(시안 13, 계획서 P6-12): "이 문단 다시 번역" / "직접 고치기" / "복사". 고른 문단과
 * 실패·거절 문단(다시 번역만)에 보인다. 다시 번역하는 동안 그 문단은 진행 표시이고 다른 문단의 다시 번역은
 * 막힌다(한 번에 하나).
 */
export function ParagraphActions({
  paragraph,
  isActive,
  onEdit
}: ParagraphActionsProps) {
  const retranslatingKey = useRetranslatingParagraphKey();

  if (retranslatingKey === paragraph.key) {
    return (
      <span
        role="status"
        className={cn(ACTION_ROW_CLASS, "text-muted-foreground text-xs")}
      >
        <Loader2
          size={SPINNER_SIZE}
          aria-hidden="true"
          className="motion-safe:animate-spin"
        />
        {PARAGRAPH_ACTION_TEXT.RETRANSLATING}
      </span>
    );
  }
  if (!isActive && !isUntranslatedParagraph(paragraph)) return null;

  const { target } = paragraph;
  return (
    <span
      role="group"
      aria-label={PARAGRAPH_ACTION_TEXT.ACTIONS}
      className={ACTION_ROW_CLASS}
    >
      <button
        type="button"
        title={PARAGRAPH_ACTION_TEXT.RETRANSLATE_DESCRIPTION}
        disabled={retranslatingKey !== null}
        onClick={() => void retranslateParagraph(paragraph.key)}
        className={PARAGRAPH_BUTTON_CLASS.OUTLINE}
      >
        {PARAGRAPH_ACTION_TEXT.RETRANSLATE}
      </button>
      {isActive && (
        <button
          type="button"
          onClick={onEdit}
          className={PARAGRAPH_BUTTON_CLASS.OUTLINE}
        >
          {PARAGRAPH_ACTION_TEXT.EDIT}
        </button>
      )}
      {isActive && target !== null && (
        <button
          type="button"
          onClick={() => void copyParagraphText(target)}
          className={PARAGRAPH_BUTTON_CLASS.GHOST}
        >
          {PARAGRAPH_ACTION_TEXT.COPY}
        </button>
      )}
    </span>
  );
}
