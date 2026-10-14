import { ArrowRight } from "lucide-react";
import { HOME_ILLUSTRATION_TEST_ID, HOME_LAYOUT } from "../config/home-layout";

/** 합칠 문서 세 장의 위 테두리(병합 화면의 파일 그룹 색) */
const SOURCE_SHEET_BORDERS = [
  "border-t-group-1",
  "border-t-group-2",
  "border-t-group-3"
] as const;

const SHEET_CLASS = "bg-paper shadow-paper rounded-paper";
const ARROW_SIZE = 24;

/** 병합 카드 그림(시안 1): 문서 세 장 → 한 묶음 */
export function MergeIllustration() {
  return (
    <div
      aria-hidden="true"
      data-testid={HOME_ILLUSTRATION_TEST_ID}
      className={HOME_LAYOUT.ILLUSTRATION_FRAME}
    >
      <div className={`${HOME_LAYOUT.ILLUSTRATION_SCALE} gap-3`}>
        <div className="flex shrink-0 items-center gap-2">
          {SOURCE_SHEET_BORDERS.map((borderClass) => (
            <div
              key={borderClass}
              className={`${SHEET_CLASS} h-15.5 w-11 border-t-3 ${borderClass}`}
            />
          ))}
        </div>
        <ArrowRight
          size={ARROW_SIZE}
          className="text-muted-foreground shrink-0"
        />
        <div className="relative h-21 w-15 shrink-0">
          <div className={`${SHEET_CLASS} absolute top-0 left-2 h-18.5 w-13`} />
          <div
            className={`${SHEET_CLASS} outline-primary absolute top-2.5 left-0 h-18.5 w-13 outline-2 outline-offset-2`}
          />
        </div>
      </div>
    </div>
  );
}
