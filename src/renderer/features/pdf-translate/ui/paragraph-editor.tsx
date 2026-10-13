import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TranslatedParagraph } from "@/renderer/shared/api/bindings";
import { isPrimaryModifierPressed } from "@/renderer/shared/lib/keyboard";
import { PARAGRAPH_ACTION_TEXT } from "../config/translate-result";
import { editParagraph } from "../model/paragraph-actions";
import { PARAGRAPH_BUTTON_CLASS } from "./paragraph-button-class";

/** 입력 칸 처음 줄 수(늘리면 행 높이가 따라 바뀐다) */
const EDITOR_ROWS = 4;

const SAVE_KEY = "Enter";
const CANCEL_KEY = "Escape";

interface ParagraphEditorProps {
  paragraph: TranslatedParagraph;
  /** 저장했거나 취소했다(위젯이 원래 글 자리로 돌린다) */
  onClose: () => void;
}

/**
 * 직접 고치기(계획서 P6-12): 번역 자리의 여러 줄 입력. "저장"(⌘/Ctrl+Enter)은 기록에 쓰고 결과 문단을 바꾸며,
 * "취소"(Esc)는 그대로 닫는다. 비워 저장하면 원래 번역으로 돌아간다(Rust 규칙). 고치지 않았으면 쓰지 않고 닫는다.
 * 입력 칸의 방향키는 쪽·문단을 옮기지 않는다(결과 화면 키보드가 글자 입력 요소를 건너뛴다).
 */
export function ParagraphEditor({ paragraph, onClose }: ParagraphEditorProps) {
  const original = paragraph.target ?? "";
  const [text, setText] = useState(original);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 열면 입력 칸에 초점을 두고 커서를 글 끝에 둔다.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const handleSave = async () => {
    if (isSaving) return;
    if (text.trim() === original) {
      onClose();
      return;
    }
    setIsSaving(true);
    const isSaved = await editParagraph({ key: paragraph.key, text });
    if (isSaved) {
      onClose();
      return;
    }
    setIsSaving(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === CANCEL_KEY) {
      event.preventDefault();
      onClose();
    } else if (event.key === SAVE_KEY && isPrimaryModifierPressed(event)) {
      event.preventDefault();
      void handleSave();
    }
  };

  return (
    <span className="flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        aria-label={PARAGRAPH_ACTION_TEXT.EDITOR}
        rows={EDITOR_ROWS}
        value={text}
        readOnly={isSaving}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        className="bg-card border-input focus-visible:ring-ring w-full resize-y rounded-md border px-2 py-1.5 focus-visible:ring-2 focus-visible:outline-none"
      />
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void handleSave()}
          className={PARAGRAPH_BUTTON_CLASS.PRIMARY}
        >
          {PARAGRAPH_ACTION_TEXT.SAVE}
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={onClose}
          className={PARAGRAPH_BUTTON_CLASS.OUTLINE}
        >
          {PARAGRAPH_ACTION_TEXT.CANCEL}
        </button>
      </span>
    </span>
  );
}
