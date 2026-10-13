import {
  BADGE_TONE,
  COMPARE_SIDE_BADGE,
  COMPARE_SIDES,
  COMPARISON_TEXT,
  displayPageNumber,
  isOcrPage,
  pageOfPair,
  TextBadge,
  type PageHighlights,
  type PagePair,
  type PageSources,
  type Side
} from "@/renderer/entities/comparison";
import type { CompareFile } from "@/renderer/features/pdf-compare";
import { VIEWER_LAYOUT, missingPageText } from "../config/viewer-layout";
import type { PanePadding } from "../lib/pane-layout";
import type { RowSlot, ViewerRow } from "../lib/row-layout";
import { PageView } from "./page-view";

const NO_HIGHLIGHTS: readonly never[] = [];

/** 쪽 이름("A 2쪽") */
interface PageLabelParams {
  side: Side;
  page: number;
}

function pageLabelOf({ side, page }: PageLabelParams): string {
  return `${COMPARE_SIDE_BADGE[side]} ${displayPageNumber(page)}쪽`;
}

/** 행 이름: 있는 쪽만("A 2쪽 · B 3쪽", 짝이 없으면 "B 3쪽") */
function rowLabelOf(pair: PagePair): string {
  return COMPARE_SIDES.flatMap((side) => {
    const page = pageOfPair({ pair, side });
    return page === null ? [] : [pageLabelOf({ side, page })];
  }).join(" · ");
}

interface PageCaptionProps {
  slot: RowSlot;
  file: CompareFile;
  pageSources: PageSources;
}

/** 쪽 위 캡션(시안 4): A·B 배지 + "파일 이름 · 3쪽", OCR로 읽은 쪽이면 "OCR" 배지 */
function PageCaption({ slot, file, pageSources }: PageCaptionProps) {
  const { side, page } = slot;
  const isOcr = page !== null && isOcrPage({ pageSources, side, page });
  return (
    <div
      className="flex min-w-0 items-center justify-center gap-1.5 text-xs/4 font-medium"
      style={{ height: VIEWER_LAYOUT.CAPTION_HEIGHT_PX }}
    >
      <span className="bg-foreground text-background flex size-4 shrink-0 items-center justify-center rounded-xs text-[10px]">
        {COMPARE_SIDE_BADGE[side]}
      </span>
      <span className="truncate">
        {page === null
          ? file.name
          : `${file.name} · ${displayPageNumber(page)}쪽`}
      </span>
      {isOcr && (
        <TextBadge label={COMPARISON_TEXT.OCR} tone={BADGE_TONE.MUTED} />
      )}
    </div>
  );
}

interface MissingPageProps {
  slot: RowSlot;
}

/** 짝 없는 쪽 자리표시: 반대편 쪽과 같은 크기의 점선 상자 */
function MissingPage({ slot }: MissingPageProps) {
  return (
    <div
      className="border-input bg-card-inset text-muted-foreground rounded-paper mx-auto flex items-center justify-center border border-dashed text-xs"
      style={{ width: slot.widthPx, height: slot.heightPx }}
    >
      {missingPageText(COMPARE_SIDE_BADGE[slot.side])}
    </div>
  );
}

interface PaneRowProps {
  row: ViewerRow;
  side: Side;
  padding: PanePadding;
  file: CompareFile;
  pageSources: PageSources;
  highlights: PageHighlights;
  activeChangeId: string | null;
  hoveredChangeId: string | null;
  renderScale: number;
}

/**
 * 패널 하나의 행 = `page_pairs`의 한 쌍 중 그 문서 쪽(계획서 P3-4·§7.1). 캡션 줄 + 쪽(짝이 없으면 자리표시).
 * 높이는 두 패널이 같다(행 배치). 쪽은 바깥 여백 안 칸의 가로 가운데다(`lib/pane-layout.ts`와 같은 규칙).
 */
export function PaneRow({
  row,
  side,
  padding,
  file,
  pageSources,
  highlights,
  activeChangeId,
  hoveredChangeId,
  renderScale
}: PaneRowProps) {
  const slot = row.slots.find((candidate) => candidate.side === side);
  return (
    <div
      role="group"
      aria-label={rowLabelOf(row.pair)}
      style={{
        height: row.heightPx,
        paddingLeft: padding.left,
        paddingRight: padding.right
      }}
    >
      {slot && (
        <PageCaption slot={slot} file={file} pageSources={pageSources} />
      )}
      {slot && slot.page === null && <MissingPage slot={slot} />}
      {slot && slot.page !== null && (
        <PageView
          path={file.path}
          side={side}
          page={slot.page}
          label={pageLabelOf({ side, page: slot.page })}
          widthPx={slot.widthPx}
          heightPx={slot.heightPx}
          renderScale={renderScale}
          highlights={highlights.get(slot.page) ?? NO_HIGHLIGHTS}
          activeChangeId={activeChangeId}
          hoveredChangeId={hoveredChangeId}
        />
      )}
    </div>
  );
}
