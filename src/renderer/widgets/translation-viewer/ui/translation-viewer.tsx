import { useCallback, useMemo } from "react";
import {
  useTranslateResult,
  useTranslateResultView,
  useTranslateResultViewActions
} from "@/renderer/features/pdf-translate";
import { steppedParagraphKey } from "../lib/paragraph-step";
import { useViewerKeyboard } from "../model/use-viewer-keyboard";
import { BilingualPage } from "./bilingual-page";
import { GlossaryButton } from "./glossary-button";
import { PageNavigator } from "./page-navigator";
import { ViewModeToggle } from "./view-mode-toggle";
import { ZoomControls } from "./zoom-controls";

/**
 * 번역 결과 대역 보기(시안 13, 계획서 P6-11). 머리는 앱 툴바(`AppToolbarTranslate`)가 그린다.
 * 툴바(보기 방식·용어집 n·쪽 이동·배율) / 한 번에 한 쪽의 원문·번역 문단 행.
 * ←→ 쪽 이동, ↑↓ 문단 고르기. 문단 동작(다시 번역·직접 고치기·복사)은 Step 47이 더한다.
 */
export function TranslationViewer() {
  const result = useTranslateResult();
  const { viewMode, page, zoomPercent, activeParagraphKey } =
    useTranslateResultView();
  const { setViewMode, setPage, setZoomPercent, selectParagraph } =
    useTranslateResultViewActions();
  const currentPage = result?.pages[page] ?? null;
  const paragraphKeys = useMemo(
    () => currentPage?.paragraphs.map((paragraph) => paragraph.key) ?? [],
    [currentPage]
  );

  const handlePageStep = useCallback(
    (step: number) => setPage(page + step),
    [page, setPage]
  );
  const handleParagraphStep = useCallback(
    (step: number) => {
      const key = steppedParagraphKey({
        keys: paragraphKeys,
        activeKey: activeParagraphKey,
        step
      });
      if (key !== null) selectParagraph(key);
    },
    [paragraphKeys, activeParagraphKey, selectParagraph]
  );
  useViewerKeyboard({
    onPageStep: handlePageStep,
    onParagraphStep: handleParagraphStep
  });

  if (result === null || currentPage === null) return null;

  return (
    <div className="flex min-w-0 flex-1 flex-col text-sm/5.25">
      <div className="border-border bg-card flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 border-b px-6 py-2">
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
        <GlossaryButton terms={result.glossaryUsed} />
        <span className="grow" />
        <PageNavigator
          page={page}
          pageCount={result.pages.length}
          onChange={setPage}
        />
        <ZoomControls zoomPercent={zoomPercent} onChange={setZoomPercent} />
      </div>
      {/* 쪽을 옮기면 본문을 새로 그려 스크롤을 맨 위로 돌린다. */}
      <div
        key={page}
        className="bg-canvas min-h-0 flex-1 overflow-auto px-6 py-5"
      >
        <BilingualPage
          page={currentPage}
          viewMode={viewMode}
          zoomPercent={zoomPercent}
          activeParagraphKey={activeParagraphKey}
          onSelectParagraph={selectParagraph}
        />
      </div>
    </div>
  );
}
