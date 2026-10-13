import { cn } from "@/renderer/shared/lib/utils";

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

interface ProgressBarProps {
  /** 접근 가능한 이름(`aria-label`) */
  label: string;
  /** 0~100 정수 */
  percent: number;
  /** 막대 바탕(높이 등) */
  className: string;
  /** 채움 색 */
  fillClassName: string;
}

/** `role="progressbar"` 막대. 값은 `aria-valuenow`로도 읽힌다. */
export function ProgressBar({
  label,
  percent,
  className,
  fillClassName
}: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={PERCENT_MIN}
      aria-valuemax={PERCENT_MAX}
      aria-valuenow={percent}
      className={cn(
        "bg-secondary w-full overflow-hidden rounded-full",
        className
      )}
    >
      <div
        className={cn("h-full rounded-full transition-all", fillClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
