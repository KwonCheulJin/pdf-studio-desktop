import { useId, type ReactNode, type RefObject } from "react";
import { HOME_LAYOUT } from "../config/home-layout";
import { Button } from "@/renderer/shared/ui";

interface TaskCardProps {
  ref: RefObject<HTMLElement | null>;
  title: string;
  description: string;
  actionLabel: string;
  /** 같은 화면에 이름이 같은 버튼이 여럿일 때 스크린 리더용으로 구분하는 이름(보이는 글자를 포함해야 한다). */
  actionAriaLabel?: string;
  /** 버튼 옆에 받는 파일을 적는다. */
  caption: string;
  /** 끌어온 파일이 이 카드 위에 있다. */
  isDropTarget: boolean;
  illustration: ReactNode;
  onAction: () => void;
}

/** 홈의 작업 카드 하나(시안 1): 그림, 제목·설명, 파일 선택 버튼. */
export function TaskCard({
  ref,
  title,
  description,
  actionLabel,
  actionAriaLabel,
  caption,
  isDropTarget,
  illustration,
  onAction
}: TaskCardProps) {
  const titleId = useId();

  return (
    <section
      ref={ref}
      aria-labelledby={titleId}
      className={`bg-card border-border flex flex-col gap-5 rounded-lg border p-6 shadow-sm transition-shadow ${
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
      <div className="flex flex-wrap items-center gap-3">
        <Button
          aria-label={actionAriaLabel}
          className="h-9 rounded-md px-4 font-medium"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
        <span className="text-muted-foreground text-xs/4.25">{caption}</span>
      </div>
    </section>
  );
}
