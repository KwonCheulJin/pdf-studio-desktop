import { useId } from "react";
import { cn } from "@/renderer/shared/lib/utils";
import { Checkbox } from "@/renderer/shared/ui";
import {
  COMPARE_OPTIONS_TEXT,
  compareRunMessage,
  IGNORE_CASE_OPTION,
  TEXT_TARGET,
  UPCOMING_TARGETS
} from "../config/compare-options";
import {
  useCompareOptions,
  useCompareSessionStore,
  useIsTextCompared
} from "../model/compare-session-store";

/**
 * 표 행: 체크 · 이름(84px) · 설명 · 배지(시안 3). 행 높이는 시안이 그려지는 값(content-box
 * `min-height`에 패딩·테두리가 더해진 60·49·61px)이다.
 */
const ROW_CLASS = "flex items-center gap-2.5 px-3.5";
/** 체크 칸(20px): 16px 체크박스를 이름 앞 같은 자리에 둔다. */
const CHECK_SLOT_CLASS = "flex w-5 shrink-0 items-center";
const NAME_CLASS = "w-21 shrink-0";
const DESCRIPTION_CLASS = "min-w-0 flex-1 text-xs/4.25";
const PILL_CLASS = "shrink-0 rounded-full px-2 text-xs/5 font-medium";

interface UpcomingTargetRowProps {
  name: string;
  description: string;
}

/** 아직 비교하지 않는 대상(Phase 5): 꺼진 채 "준비 중" */
function UpcomingTargetRow({ name, description }: UpcomingTargetRowProps) {
  const nameId = useId();
  return (
    <div
      className={cn(
        ROW_CLASS,
        "border-border text-muted-foreground min-h-15.25 border-t py-1.5"
      )}
    >
      <span className={CHECK_SLOT_CLASS}>
        <Checkbox disabled aria-labelledby={nameId} />
      </span>
      <span id={nameId} className={cn(NAME_CLASS, "font-semibold")}>
        {name}
      </span>
      <span className={DESCRIPTION_CLASS}>{description}</span>
      <span className={cn(PILL_CLASS, "bg-muted")}>
        {COMPARE_OPTIONS_TEXT.TARGET_UPCOMING_BADGE}
      </span>
    </div>
  );
}

/**
 * 비교 대상 표(계획서 P3-3): 글자(기본, 켬)와 하위 옵션 대소문자 무시. 글자층이 없는 쪽은 자동으로
 * OCR하므로 따로 켜는 옵션은 없다. 스타일·레이아웃·그림은 "준비 중"으로 꺼 둔다.
 */
export function CompareTargetTable() {
  const titleId = useId();
  const textId = useId();
  const textDescriptionId = useId();
  const ignoreCaseId = useId();
  const ignoreCaseDescriptionId = useId();
  const isTextCompared = useIsTextCompared();
  const { ignoreCase } = useCompareOptions();
  const setTextCompared = useCompareSessionStore(
    (state) => state.setTextCompared
  );
  const setIgnoreCase = useCompareSessionStore((state) => state.setIgnoreCase);
  // 켤 수 있는 대상은 지금 글자 하나다.
  const enabledCount = Number(isTextCompared);

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="border-border overflow-hidden rounded-lg border"
    >
      <div className="bg-card-inset border-border flex items-center gap-2 border-b px-3.5 py-2.5">
        <span id={titleId} className="font-semibold">
          {COMPARE_OPTIONS_TEXT.TARGET_TITLE}
        </span>
        <span className="text-muted-foreground text-xs">
          {compareRunMessage.targetCount(enabledCount)}
        </span>
      </div>
      <label
        className={cn(
          ROW_CLASS,
          "min-h-15 cursor-pointer py-1.5",
          isTextCompared && "bg-accent"
        )}
      >
        <span className={CHECK_SLOT_CLASS}>
          <Checkbox
            checked={isTextCompared}
            onCheckedChange={(checked) => setTextCompared(checked === true)}
            aria-labelledby={textId}
            aria-describedby={textDescriptionId}
          />
        </span>
        <span id={textId} className={cn(NAME_CLASS, "font-semibold")}>
          {TEXT_TARGET.name}
        </span>
        <span
          id={textDescriptionId}
          className={cn(DESCRIPTION_CLASS, "text-muted-foreground")}
        >
          {TEXT_TARGET.description}
        </span>
        <span className={cn(PILL_CLASS, "border-input border")}>
          {COMPARE_OPTIONS_TEXT.TARGET_DEFAULT_BADGE}
        </span>
      </label>
      <label
        className={cn(
          ROW_CLASS,
          "border-border min-h-12.25 cursor-pointer border-t border-dashed py-1 pl-11",
          !isTextCompared && "text-muted-foreground cursor-not-allowed"
        )}
      >
        <span className={CHECK_SLOT_CLASS}>
          <Checkbox
            checked={ignoreCase}
            disabled={!isTextCompared}
            onCheckedChange={(checked) => setIgnoreCase(checked === true)}
            aria-labelledby={ignoreCaseId}
            aria-describedby={ignoreCaseDescriptionId}
          />
        </span>
        <span id={ignoreCaseId} className={cn(NAME_CLASS, "text-[13px]")}>
          {IGNORE_CASE_OPTION.name}
        </span>
        <span
          id={ignoreCaseDescriptionId}
          className={cn(DESCRIPTION_CLASS, "text-muted-foreground")}
        >
          {IGNORE_CASE_OPTION.description}
        </span>
      </label>
      {UPCOMING_TARGETS.map((target) => (
        <UpcomingTargetRow
          key={target.name}
          name={target.name}
          description={target.description}
        />
      ))}
    </div>
  );
}
