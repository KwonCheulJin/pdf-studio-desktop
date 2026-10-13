import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ComparePage } from "@/renderer/pages/compare";
import { HomePage } from "@/renderer/pages/home";
import { MergedPreviewPage } from "@/renderer/pages/merged-preview";
import { TranslatePage } from "@/renderer/pages/translate";
import { MergeWorkspace } from "@/renderer/widgets/merge-workspace";
import { SettingsDialog } from "@/renderer/widgets/settings-dialog";
import { useCompareFilePaths } from "@/renderer/features/pdf-compare";
import { MergeProgressOverlay } from "@/renderer/features/pdf-merge";
import { useTranslateFilePaths } from "@/renderer/features/pdf-translate";
import {
  MERGE_VIEW,
  useMergeStore,
  useMergeView,
  type MergeView
} from "@/renderer/entities/merge-plan";
import { usePdfDocumentRetention } from "@/renderer/shared/lib/pdfjs";
import {
  APP_MODE,
  useAppMode,
  useAppModeStore,
  useSettingsShortcut,
  type AppMode
} from "../model";
import { AppCompareStatusBar } from "./app-compare-status-bar";
import { AppHomeHeader } from "./app-home-header";
import { AppHomeStatusBar } from "./app-home-status-bar";
import { AppStatusBar } from "./app-status-bar";
import { AppToolbar } from "./app-toolbar";
import { AppToolbarCompare } from "./app-toolbar-compare";
import { AppToolbarPreview } from "./app-toolbar-preview";
import { AppToolbarTranslate } from "./app-toolbar-translate";
import { AppTranslateStatusBar } from "./app-translate-status-bar";

interface ModeScreenProps {
  mode: AppMode;
  mergeView: MergeView;
}

interface ModeHeaderProps extends ModeScreenProps {
  onOpenSettings: () => void;
}

function ModeHeader({ mode, mergeView, onOpenSettings }: ModeHeaderProps) {
  switch (mode) {
    case APP_MODE.HOME:
      return <AppHomeHeader onOpenSettings={onOpenSettings} />;
    case APP_MODE.COMPARE:
      return <AppToolbarCompare />;
    case APP_MODE.TRANSLATE:
      return <AppToolbarTranslate onOpenSettings={onOpenSettings} />;
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
    case APP_MODE.TRANSLATE:
      return <AppTranslateStatusBar />;
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
  // 비교 슬롯의 문서도 같다. 모드를 오가도 썸네일을 그리려고 다시 읽지 않는다.
  const comparePaths = useCompareFilePaths();
  usePdfDocumentRetention(comparePaths);
  // 번역 문서도 같다.
  const translatePaths = useTranslateFilePaths();
  usePdfDocumentRetention(translatePaths);

  const handleEnterMerge = useCallback(
    () => setMode(APP_MODE.MERGE),
    [setMode]
  );
  const handleEnterCompare = useCallback(
    () => setMode(APP_MODE.COMPARE),
    [setMode]
  );
  const handleEnterTranslate = useCallback(
    () => setMode(APP_MODE.TRANSLATE),
    [setMode]
  );
  const handleExitCompare = useCallback(
    () => setMode(APP_MODE.HOME),
    [setMode]
  );
  // 설정 모달은 홈·번역 머리 톱니와 모든 화면의 ⌘,/Ctrl+,로 연다(Q16).
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  useSettingsShortcut(handleOpenSettings);

  const renderContent = () => {
    switch (mode) {
      case APP_MODE.HOME:
        return (
          <HomePage
            onEnterMerge={handleEnterMerge}
            onEnterCompare={handleEnterCompare}
            onEnterTranslate={handleEnterTranslate}
          />
        );
      case APP_MODE.COMPARE:
        return <ComparePage onExit={handleExitCompare} />;
      case APP_MODE.TRANSLATE:
        return <TranslatePage />;
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
      <ModeHeader
        mode={mode}
        mergeView={view}
        onOpenSettings={handleOpenSettings}
      />
      <main className="flex flex-1 overflow-hidden">{renderContent()}</main>
      <ModeStatusBar mode={mode} />
      <MergeProgressOverlay />
      <SettingsDialog
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  );
}
