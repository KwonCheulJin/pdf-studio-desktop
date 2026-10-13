import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { GlossaryTerm } from "@/renderer/shared/api/bindings";
import { VIEWER_TEXT, viewerText } from "../config/viewer";

const CLOSE_KEY = "Escape";

interface GlossaryButtonProps {
  /** 번역에 실은 용어(`TranslationResult.glossaryUsed`) */
  terms: readonly GlossaryTerm[];
}

/**
 * "용어집 n"(시안 13): 누르면 실은 용어 목록 팝오버(읽기 전용) + "용어집을 바꾸면 다시 번역해야 반영돼요.".
 * 바깥을 누르거나 Esc로 닫는다. 실은 용어가 없으면 버튼을 막는다.
 */
export function GlossaryButton({ terms }: GlossaryButtonProps) {
  const panelId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 열리면 팝오버로 초점을 옮기고, 바깥 누르기를 구독해 닫는다.
  useEffect(() => {
    if (!isOpen) return undefined;
    panelRef.current?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target) === true
      ) {
        return;
      }
      setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== CLOSE_KEY) return;
    event.preventDefault();
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        disabled={terms.length === 0}
        onClick={() => setIsOpen((open) => !open)}
        className="border-border bg-card hover:bg-accent focus-visible:ring-ring h-7 rounded-sm border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        {viewerText.glossaryButton(terms.length)}
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={VIEWER_TEXT.GLOSSARY}
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
          className="bg-card border-border absolute top-full left-0 z-20 mt-1.5 flex w-72 flex-col gap-2 rounded-md border p-3 shadow-md focus-visible:outline-none"
        >
          <ul className="flex max-h-64 flex-col gap-1 overflow-auto text-[13px]/5">
            {terms.map((term) => (
              <li key={term.source} className="flex gap-2">
                <span className="min-w-0 break-words">{term.source}</span>
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
                <span className="min-w-0 break-words">{term.target}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs/4.25">
            {VIEWER_TEXT.GLOSSARY_NOTE}
          </p>
        </div>
      )}
    </div>
  );
}
