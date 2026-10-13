import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { VIEWER_TEXT, viewerText } from "../config/viewer";

const STEP_ICON_SIZE = 14;

const STEP_BUTTON_CLASS =
  "border-border bg-card hover:bg-accent focus-visible:ring-ring flex size-7 items-center justify-center rounded-sm border transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

/** 쪽 번호 칸에서 입력을 끝내는 키와 되돌리는 키 */
const COMMIT_KEY = "Enter";
const REVERT_KEY = "Escape";

/** 화면 쪽 번호는 1부터, 결과 쪽 색인은 0부터 */
const PAGE_NUMBER_OFFSET = 1;
const DECIMAL_RADIX = 10;
const DIGITS_PATTERN = /^\d+$/;

interface PageNavigatorProps {
  /** 보고 있는 쪽(0부터) */
  page: number;
  pageCount: number;
  /** 옮길 쪽(0부터). 범위는 받는 쪽이 자른다. */
  onChange: (page: number) => void;
}

/**
 * 쪽 이동 `‹ 3 / 24쪽 ›`(시안 13). 쪽 번호 칸에 적고 Enter(또는 칸을 떠나면)로 옮기고, Esc나 틀린 값은 되돌린다.
 * 키보드 ←→는 결과 화면 키보드가 같은 이동을 쓴다.
 */
export function PageNavigator({
  page,
  pageCount,
  onChange
}: PageNavigatorProps) {
  /** 적는 중인 글자. 적지 않을 때는 지금 쪽을 보인다. */
  const [draft, setDraft] = useState<string | null>(null);
  const pageNumber = page + PAGE_NUMBER_OFFSET;

  const commitDraft = () => {
    if (draft === null) return;
    setDraft(null);
    const trimmed = draft.trim();
    if (!DIGITS_PATTERN.test(trimmed)) return;
    const typed = Number.parseInt(trimmed, DECIMAL_RADIX);
    if (typed < PAGE_NUMBER_OFFSET || typed > pageCount) return;
    onChange(typed - PAGE_NUMBER_OFFSET);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === COMMIT_KEY) {
      event.preventDefault();
      commitDraft();
    } else if (event.key === REVERT_KEY) {
      event.preventDefault();
      setDraft(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={VIEWER_TEXT.PREVIOUS_PAGE}
        disabled={pageNumber <= PAGE_NUMBER_OFFSET}
        onClick={() => onChange(page - PAGE_NUMBER_OFFSET)}
        className={STEP_BUTTON_CLASS}
      >
        <ChevronLeft size={STEP_ICON_SIZE} aria-hidden="true" />
      </button>
      <span className="flex min-w-16 items-center justify-center gap-1 font-mono text-xs">
        <input
          type="text"
          inputMode="numeric"
          aria-label={VIEWER_TEXT.PAGE_NUMBER}
          value={draft ?? String(pageNumber)}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setDraft(event.target.value)
          }
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
          onFocus={(event) => event.target.select()}
          size={String(pageCount).length}
          className="hover:border-input focus-visible:border-ring focus-visible:ring-ring h-6 rounded-xs border border-transparent bg-transparent text-center focus-visible:ring-1 focus-visible:outline-none"
        />
        <span>{viewerText.pageTotal(pageCount)}</span>
      </span>
      <button
        type="button"
        aria-label={VIEWER_TEXT.NEXT_PAGE}
        disabled={pageNumber >= pageCount}
        onClick={() => onChange(page + PAGE_NUMBER_OFFSET)}
        className={STEP_BUTTON_CLASS}
      >
        <ChevronRight size={STEP_ICON_SIZE} aria-hidden="true" />
      </button>
    </div>
  );
}
