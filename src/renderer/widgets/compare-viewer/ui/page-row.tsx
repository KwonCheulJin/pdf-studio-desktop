import { Fragment } from "react";
import {
  BADGE_TONE,
  COMPARE_SIDE,
  COMPARE_SIDE_BADGE,
  COMPARE_SIDES,
  COMPARISON_TEXT,
  displayPageNumber,
  isOcrPage,
  pageOfPair,
  TextBadge,
  type ConnectorStem,
  type PageHighlights,
  type PagePair,
  type PageSources,
  type Side
} from "@/renderer/entities/comparison";
import type { CompareFile } from "@/renderer/features/pdf-compare";
import { VIEWER_LAYOUT, missingPageText } from "../config/viewer-layout";
import type { RowSlot, ViewerRow } from "../lib/row-layout";
import { ConnectorLayer, type ConnectorPage } from "./connector-layer";
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
    <div className="flex h-full min-w-0 items-center justify-center gap-1.5 text-xs/4 font-medium">
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
      className="border-input bg-card-inset text-muted-foreground rounded-paper flex items-center justify-center justify-self-center border border-dashed text-xs"
      style={{ width: slot.widthPx, height: slot.heightPx }}
    >
      {missingPageText(COMPARE_SIDE_BADGE[slot.side])}
    </div>
  );
}

interface ConnectorEnds {
  before: ConnectorPage;
  after: ConnectorPage;
  widthPx: number;
}

/** 나란히 보기에서 두 쪽이 모두 있는 행이면 연결선 양끝 쪽(자리표시자 행은 잇지 않는다) */
function connectorEndsOf(
  row: ViewerRow,
  files: Record<Side, CompareFile>
): ConnectorEnds | null {
  const [beforeSlot, afterSlot] = row.slots;
  if (
    row.gutterPx === null ||
    !beforeSlot ||
    !afterSlot ||
    beforeSlot.page === null ||
    afterSlot.page === null
  ) {
    return null;
  }
  return {
    before: {
      path: files[COMPARE_SIDE.BEFORE].path,
      page: beforeSlot.page,
      heightPx: beforeSlot.heightPx
    },
    after: {
      path: files[COMPARE_SIDE.AFTER].path,
      page: afterSlot.page,
      heightPx: afterSlot.heightPx
    },
    widthPx: row.gutterPx
  };
}

interface GutterProps {
  row: ViewerRow;
  files: Record<Side, CompareFile>;
  stems: readonly ConnectorStem[];
  activeChangeId: string | null;
}

/** 두 쪽 사이 거터(너비 고정, 높이는 큰 쪽). 이 행에 이을 묶음이 있으면 연결선을 그린다. */
function Gutter({ row, files, stems, activeChangeId }: GutterProps) {
  const heightPx = Math.max(...row.slots.map((slot) => slot.heightPx));
  const ends = stems.length > 0 ? connectorEndsOf(row, files) : null;
  return (
    <div
      aria-hidden="true"
      data-connector-gutter=""
      className="relative"
      style={{ height: heightPx }}
    >
      {ends && (
        <ConnectorLayer
          stems={stems}
          before={ends.before}
          after={ends.after}
          widthPx={ends.widthPx}
          heightPx={heightPx}
          activeChangeId={activeChangeId}
        />
      )}
    </div>
  );
}

const NO_STEMS: readonly ConnectorStem[] = [];

interface PageRowProps {
  row: ViewerRow;
  files: Record<Side, CompareFile>;
  pageSources: PageSources;
  highlights: Record<Side, PageHighlights>;
  /** 이 행의 연결선 묶음. 연결선을 끈 상태면 `null` */
  stems: readonly ConnectorStem[] | null;
  activeChangeId: string | null;
  hoveredChangeIds: readonly string[];
  renderScale: number;
}

/**
 * 페이지 영역 행 하나 = `page_pairs`의 한 쌍(계획서 P3-4). 캡션 줄 + `A 쪽 | 거터 | B 쪽`.
 * 거터에는 연결선(계획서 §7.1)을 그린다. 한쪽만 보기에서는 거터와 반대편이 없다.
 */
export function PageRow({
  row,
  files,
  pageSources,
  highlights,
  stems,
  activeChangeId,
  hoveredChangeIds,
  renderScale
}: PageRowProps) {
  const columns = row.slots.map(() => "minmax(0, 1fr)");
  const gridTemplateColumns =
    row.gutterPx === null
      ? columns.join(" ")
      : columns.join(` ${row.gutterPx}px `);
  const renderSlot = (slot: RowSlot) =>
    slot.page === null ? (
      <MissingPage slot={slot} />
    ) : (
      <PageView
        path={files[slot.side].path}
        side={slot.side}
        page={slot.page}
        label={pageLabelOf({ side: slot.side, page: slot.page })}
        widthPx={slot.widthPx}
        heightPx={slot.heightPx}
        renderScale={renderScale}
        highlights={highlights[slot.side].get(slot.page) ?? NO_HIGHLIGHTS}
        activeChangeId={activeChangeId}
        hoveredChangeIds={hoveredChangeIds}
      />
    );
  const hasGutter = row.gutterPx !== null;

  return (
    <div
      role="group"
      aria-label={rowLabelOf(row.pair)}
      className="px-4"
      style={{ height: row.heightPx }}
    >
      <div
        className="grid items-start"
        style={{
          gridTemplateColumns,
          gridTemplateRows: `${VIEWER_LAYOUT.CAPTION_HEIGHT_PX}px auto`
        }}
      >
        {row.slots.map((slot, index) => (
          <Fragment key={slot.side}>
            {hasGutter && index > 0 && <span aria-hidden="true" />}
            <PageCaption
              slot={slot}
              file={files[slot.side]}
              pageSources={pageSources}
            />
          </Fragment>
        ))}
        {row.slots.map((slot, index) => (
          <Fragment key={slot.side}>
            {hasGutter && index > 0 && (
              <Gutter
                row={row}
                files={files}
                stems={stems ?? NO_STEMS}
                activeChangeId={activeChangeId}
              />
            )}
            {renderSlot(slot)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
