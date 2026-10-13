import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/renderer/shared/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** 묶음의 접근 가능한 이름 */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** 앞뒤 칸으로 옮기는 키와 옮길 칸 수 */
const ARROW_STEP: Record<string, number> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1
};

/**
 * 하나만 고르는 세그먼트(라디오 묶음). 고른 칸만 Tab으로 들어오고 방향키로 옮기면 바로 고른다.
 * 모양은 시안 14 "기본 모델"(`secondary` 바탕 안에 고른 칸만 `card`).
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange
}: SegmentedControlProps<T>) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const nextIndex = (index + step + options.length) % options.length;
    onChange(options[nextIndex].value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="bg-secondary inline-flex gap-0.5 self-start rounded-md p-0.5"
    >
      {options.map((option, index) => {
        const isChecked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isChecked}
            tabIndex={isChecked ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "focus-visible:ring-ring h-7.5 rounded-sm px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:outline-none",
              isChecked
                ? "bg-card text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
