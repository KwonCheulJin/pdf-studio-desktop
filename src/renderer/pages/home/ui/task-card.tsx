import {
  useId,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import { ArrowRight } from "lucide-react";
import { HOME_LAYOUT } from "../config/home-layout";

const ARROW_ICON_SIZE = 14;
const ACTIVATE_KEYS: readonly string[] = ["Enter", " "];

interface TaskCardProps {
  ref: RefObject<HTMLElement | null>;
  title: string;
  description: string;
  /** 받는 파일을 적는다(고르는 버튼이 아니라 안내다). */
  caption: string;
  /** 끌어온 파일이 이 카드 위에 있다. */
  isDropTarget: boolean;
  illustration: ReactNode;
  /** 카드를 눌러 그 작업의 빈 화면으로 간다. */
  onNavigate: () => void;
}

/** 홈의 작업 카드 하나(시안 1): 그림, 제목·설명, 형식 안내. 카드 전체가 그 작업으로 가는 버튼이다. */
export function TaskCard({
  ref,
  title,
  description,
  caption,
  isDropTarget,
  illustration,
  onNavigate
}: TaskCardProps) {
  const titleId = useId();

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!ACTIVATE_KEYS.includes(event.key)) return;
    event.preventDefault();
    onNavigate();
  };

  return (
    <section
      ref={ref}
      role="button"
      tabIndex={0}
      aria-labelledby={titleId}
      onClick={onNavigate}
      onKeyDown={handleKeyDown}
      className={`bg-card border-border hover:border-primary focus-visible:ring-ring flex cursor-pointer flex-col gap-5 rounded-lg border p-6 shadow-sm transition-shadow focus-visible:ring-2 focus-visible:outline-none ${
        isDropTarget ? "ring-primary ring-2" : ""
      }`}
    >
      {illustration}
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className={HOME_LAYOUT.CARD_TITLE}>
          {title}
        </h2>
        <p className={HOME_LAYOUT.CARD_DESCRIPTION}>{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs/4.25">{caption}</span>
        <span
          aria-hidden="true"
          className="text-primary flex items-center gap-1 font-medium"
        >
          시작하기
          <ArrowRight size={ARROW_ICON_SIZE} />
        </span>
      </div>
    </section>
  );
}
