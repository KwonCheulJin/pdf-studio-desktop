import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { ComparePage } from "@/renderer/pages/compare";
import { HomePage } from "@/renderer/pages/home";
import { MergedPreviewPage } from "@/renderer/pages/merged-preview";
import { MergeWorkspace } from "@/renderer/widgets/merge-workspace";
import { MergeProgressOverlay } from "@/renderer/features/pdf-merge";
import {
  MERGE_VIEW,
  useMergeStore,
  useMergeView,
  type MergeView
} from "@/renderer/entities/merge-plan";
import { usePdfDocumentRetention } from "@/renderer/shared/lib/pdfjs";
import { APP_MODE, useAppMode, useAppModeStore, type AppMode } from "../model";
import { AppCompareStatusBar } from "./app-compare-status-bar";
import { AppHomeHeader } from "./app-home-header";
import { AppHomeStatusBar } from "./app-home-status-bar";
import { AppStatusBar } from "./app-status-bar";
import { AppToolbar } from "./app-toolbar";
import { AppToolbarCompare } from "./app-toolbar-compare";
import { AppToolbarPreview } from "./app-toolbar-preview";

interface ModeScreenProps {
  mode: AppMode;
  mergeView: MergeView;
}

function ModeHeader({ mode, mergeView }: ModeScreenProps) {
  switch (mode) {
    case APP_MODE.HOME:
      return <AppHomeHeader />;
    case APP_MODE.COMPARE:
      return <AppToolbarCompare />;
    default:
      return mergeView === MERGE_VIEW.PREVIEW ? (
        <AppToolbarPreview />
      ) : (
        <AppToolbar />
      );
  }
}

function ModeStatusBar({ mode }: Pick<ModeScreenProps, "mode">) {
  switch (mode) {
    case APP_MODE.HOME:
      return <AppHomeStatusBar />;
    case APP_MODE.COMPARE:
      return <AppCompareStatusBar />;
    default:
      return <AppStatusBar />;
  }
}

export function AppShell() {
  const mode = useAppMode();
  const setMode = useAppModeStore((state) => state.setMode);
  const view = useMergeView();
  // 작업 공간에 있는 파일은 화면(카드·미리보기·병합 결과 보기)이나 모드를 오가도 다시 읽지 않는다.
  // 파일을 빼면 놓아서 문서를 닫고 렌더 캐시를 비운다.
  const sourcePaths = useMergeStore(
    useShallow((state) => state.files.map((file) => file.path))
  );
  usePdfDocumentRetention(sourcePaths);

  const handleEnterMerge = useCallback(
    () => setMode(APP_MODE.MERGE),
    [setMode]
  );
  const handleEnterCompare = useCallback(
    () => setMode(APP_MODE.COMPARE),
    [setMode]
  );

  const renderContent = () => {
    switch (mode) {
      case APP_MODE.HOME:
        return (
          <HomePage
            onEnterMerge={handleEnterMerge}
            onEnterCompare={handleEnterCompare}
          />
        );
      case APP_MODE.COMPARE:
        return <ComparePage />;
      default:
        return view === MERGE_VIEW.PREVIEW ? (
          <MergedPreviewPage />
        ) : (
          <MergeWorkspace />
        );
    }
  };

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      <ModeHeader mode={mode} mergeView={view} />
      <main className="flex flex-1 overflow-hidden">{renderContent()}</main>
      <ModeStatusBar mode={mode} />
      <MergeProgressOverlay />
    </div>
  );
}
