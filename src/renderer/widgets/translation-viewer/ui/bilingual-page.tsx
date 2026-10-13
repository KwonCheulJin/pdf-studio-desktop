import type { CSSProperties } from "react";
import {
  RESULT_VIEW_MODE,
  type ResultViewMode
} from "@/renderer/features/pdf-translate";
import { PAGE_KIND } from "@/renderer/entities/translation";
import type { TranslatedPage } from "@/renderer/shared/api/bindings";
import { getErrorMessage } from "@/renderer/shared/config/error-messages";
import { cn } from "@/renderer/shared/lib/utils";
import {
  EMPTY_PAGE_TEXT,
  PANEL_LABEL,
  PANEL_SIDE,
  PANEL_TEXT_SIZE,
  PERCENT_BASE,
  VIEW_MODE_SIDES,
  VIEWER_TEXT,
  viewerText,
  type PanelSide
} from "../config/viewer";
import { ParagraphRow } from "./paragraph-row";

/** 쪽 번호는 0부터, 화면 쪽 번호는 1부터 */
const PAGE_NUMBER_OFFSET = 1;

/**
 * 패널 모양(시안 13): 원문은 종이(`paper` + `shadow-paper`), 번역은 카드. 두 패널의 위아래 여백·테두리 두께는
 * 같아야 같은 번호 행이 같은 높이에 온다(서브그리드 행에 여백·테두리가 더해진다). 그래서 원문 종이도 투명한
 * 1px 테두리를 둔다. 종이는 두 테마 모두 흰색이라 다크 모드의 글자·고른 행(`accent`) 색과 맞지 않으므로,
 * 다크 모드의 원문 패널은 카드 바탕이다(원문 패널은 쪽 그림이 아니라 추출한 글이다, Q14).
 */
const PANEL_CLASS: Record<PanelSide, string> = {
  [PANEL_SIDE.SOURCE]:
    "bg-paper rounded-paper shadow-paper border border-transparent px-8 py-7 dark:bg-card dark:border-border dark:shadow-none",
  [PANEL_SIDE.TARGET]: "bg-card border-border rounded-lg border px-7 py-7"
};

/** 한 패널만 보일 때 너비(나란히 보기의 한 칸보다 조금 넓다) */
const SINGLE_PANEL_CLASS = "mx-auto w-full max-w-3xl";

interface PanelStyleParams {
  side: PanelSide;
  rowCount: number;
  zoomPercent: number;
}

/** 서브그리드가 바깥 격자의 문단 행 수만큼 걸치고, 글자 크기·줄 높이에 배율을 곱한다. */
function panelStyle({
  side,
  rowCount,
  zoomPercent
}: PanelStyleParams): CSSProperties {
  const scale = zoomPercent / PERCENT_BASE;
  const size = PANEL_TEXT_SIZE[side];
  return {
    gridRow: `span ${rowCount}`,
    fontSize: `${size.fontPx * scale}px`,
    lineHeight: `${size.lineHeightPx * scale}px`
  };
}

interface EmptyPageNoticeProps {
  page: TranslatedPage;
}

/** 문단이 없는 쪽의 자리표시. 스캔 쪽 그림을 보냈는데 그 쪽이 실패했으면 이유 문구 */
function EmptyPageNotice({ page }: EmptyPageNoticeProps) {
  return (
    <div className="bg-card-inset border-input text-muted-foreground mx-auto flex w-full max-w-3xl flex-col items-center gap-1 rounded-lg border border-dashed px-6 py-10 text-center">
      {page.failCode === null ? (
        <p>{EMPTY_PAGE_TEXT[page.kind]}</p>
      ) : (
        <>
          <p>{VIEWER_TEXT.IMAGE_PAGE_FAILED}</p>
          <p className="text-destructive">{getErrorMessage(page.failCode)}</p>
        </>
      )}
    </div>
  );
}

interface PanelCaptionProps {
  side: PanelSide;
  page: TranslatedPage;
}

/** 패널 머리 `원문 · 3쪽`. 스캔 쪽 그림에서 받아 적은 원문이면 "이미지에서 읽음" 배지 */
function PanelCaption({ side, page }: PanelCaptionProps) {
  return (
    <span className="text-muted-foreground flex items-center gap-2 text-xs/4 font-medium">
      {viewerText.panelCaption({
        side,
        pageNumber: page.page + PAGE_NUMBER_OFFSET
      })}
      {side === PANEL_SIDE.SOURCE && page.kind === PAGE_KIND.IMAGE && (
        <span className="bg-muted rounded-xs px-1.5 text-[11px]/4">
          {VIEWER_TEXT.IMAGE_SOURCE}
        </span>
      )}
    </span>
  );
}

interface BilingualPageProps {
  page: TranslatedPage;
  viewMode: ResultViewMode;
  zoomPercent: number;
  activeParagraphKey: string | null;
  onSelectParagraph: (key: string) => void;
}

/**
 * 한 쪽의 대역 보기(시안 13, 계획서 P6-11·Q14). 원문 패널은 쪽 그림이 아니라 추출한 원문 문단 행이다.
 * 나란히 보기는 바깥 격자의 행을 두 패널이 서브그리드로 함께 써서, 같은 번호의 원문·번역이 같은 행에 오고
 * 행 높이는 두 쪽 중 큰 쪽이다.
 */
export function BilingualPage({
  page,
  viewMode,
  zoomPercent,
  activeParagraphKey,
  onSelectParagraph
}: BilingualPageProps) {
  if (page.paragraphs.length === 0) return <EmptyPageNotice page={page} />;

  const sides = VIEW_MODE_SIDES[viewMode];
  const isSideBySide = viewMode === RESULT_VIEW_MODE.SIDE_BY_SIDE;
  const columnsClass = isSideBySide
    ? "grid-cols-2 gap-x-5"
    : cn("grid-cols-1", SINGLE_PANEL_CLASS);

  return (
    <div className="flex flex-col gap-2">
      <div className={cn("grid", columnsClass)}>
        {sides.map((side) => (
          <PanelCaption key={side} side={side} page={page} />
        ))}
      </div>
      <div className={cn("grid gap-y-2.5", columnsClass)}>
        {sides.map((side) => (
          <ol
            key={side}
            aria-label={PANEL_LABEL[side]}
            className={cn("grid min-w-0 grid-rows-subgrid", PANEL_CLASS[side])}
            style={panelStyle({
              side,
              rowCount: page.paragraphs.length,
              zoomPercent
            })}
          >
            {page.paragraphs.map((paragraph) => (
              <ParagraphRow
                key={paragraph.key}
                paragraph={paragraph}
                side={side}
                isActive={paragraph.key === activeParagraphKey}
                onSelect={onSelectParagraph}
              />
            ))}
          </ol>
        ))}
      </div>
    </div>
  );
}
