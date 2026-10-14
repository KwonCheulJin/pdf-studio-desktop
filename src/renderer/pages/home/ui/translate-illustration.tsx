import { ArrowRight } from "lucide-react";
import { HOME_ILLUSTRATION_TEST_ID, HOME_LAYOUT } from "../config/home-layout";

const ARROW_SIZE = 20;
const SHEET_CLASS =
  "bg-paper shadow-paper rounded-paper text-muted-foreground flex h-29.5 w-21 shrink-0 flex-col gap-1.5 overflow-hidden px-2.5 py-3 text-[9px]/3";
const SHEET_TITLE_CLASS = "text-foreground text-[10px]";
const SHEET_MARK_CLASS = "bg-accent rounded-paper";

/** 번역 카드 그림(시안 1): 중국어 원문 종이 → 한국어 번역 종이. 강조 문단은 같은 번호의 짝이다. */
export function TranslateIllustration() {
  return (
    <div
      aria-hidden="true"
      data-testid={HOME_ILLUSTRATION_TEST_ID}
      className={HOME_LAYOUT.ILLUSTRATION_FRAME}
    >
      <div className={`${HOME_LAYOUT.ILLUSTRATION_SCALE} gap-3`}>
        <div lang="zh-Hans" className={SHEET_CLASS}>
          <b className={SHEET_TITLE_CLASS}>产品规格</b>
          <span>本产品适用于工业环境，额定电压为220V。</span>
          <span className={SHEET_MARK_CLASS}>安装前请阅读说明书。</span>
        </div>
        <ArrowRight
          size={ARROW_SIZE}
          className="text-muted-foreground shrink-0"
        />
        <div lang="ko" className={SHEET_CLASS}>
          <b className={SHEET_TITLE_CLASS}>제품 사양</b>
          <span>이 제품은 산업 환경용이며 정격 전압은 220V입니다.</span>
          <span className={SHEET_MARK_CLASS}>설치 전에 설명서를 읽으세요.</span>
        </div>
      </div>
    </div>
  );
}
