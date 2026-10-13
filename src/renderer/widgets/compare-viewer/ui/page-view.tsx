import type { PageHighlight, Side } from "@/renderer/entities/comparison";
import { usePageGeometry, useRenderedPage } from "@/renderer/shared/lib/pdfjs";
import { VIEWER_TEXT } from "../config/viewer-layout";
import { HighlightOverlay } from "./highlight-overlay";

interface PageViewProps {
  path: string;
  side: Side;
  /** 0부터 센 쪽 번호 */
  page: number;
  /** 화면 이름("A 2쪽") */
  label: string;
  widthPx: number;
  heightPx: number;
  /** pdf.js로 그리는 배율(화면 배율 × 기기 픽셀 비율, 단위로 올림) */
  renderScale: number;
  highlights: readonly PageHighlight[];
  activeChangeId: string | null;
  hoveredChangeIds: readonly string[];
}

/**
 * 비교 결과의 쪽 하나(시안 4 종이: `paper` + `radius-paper` + `shadow-paper`). 행이 화면 근처에 있어
 * 마운트된 동안만 렌더 캐시에서 그림을 받고, 받기 전에는 스켈레톤을 보인다. 그 쪽에 변경 상자가
 * 있으면 pdf.js 화면 변환을 받아 하이라이트를 얹는다.
 */
export function PageView({
  path,
  side,
  page,
  label,
  widthPx,
  heightPx,
  renderScale,
  highlights,
  activeChangeId,
  hoveredChangeIds
}: PageViewProps) {
  const { url, isLoading, hasError } = useRenderedPage({
    path,
    pageIndex: page,
    scale: renderScale,
    isEnabled: true
  });
  const geometry = usePageGeometry({
    path,
    pageIndex: page,
    isEnabled: highlights.length > 0
  });

  return (
    <div
      role="img"
      aria-label={label}
      aria-busy={isLoading}
      className="bg-paper rounded-paper shadow-paper relative justify-self-center"
      style={{ width: widthPx, height: heightPx }}
    >
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          className="rounded-paper size-full select-none"
        />
      )}
      {isLoading && (
        <div className="bg-muted rounded-paper absolute inset-0 motion-safe:animate-pulse" />
      )}
      {hasError && (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
          {VIEWER_TEXT.RENDER_FAILED}
        </div>
      )}
      {geometry && highlights.length > 0 && (
        <HighlightOverlay
          geometry={geometry}
          highlights={highlights}
          side={side}
          activeChangeId={activeChangeId}
          hoveredChangeIds={hoveredChangeIds}
          widthPx={widthPx}
        />
      )}
    </div>
  );
}
