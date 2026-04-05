import { useState } from "react";
import { AppToolbar } from "./app-toolbar";
import { AppToolbarPreview } from "./app-toolbar-preview";
import { AppStatusBar } from "./app-status-bar";
import { MergeWorkspace } from "@/renderer/widgets/merge-workspace";
import { MergeProgressOverlay } from "@/renderer/shared/ui";
import { useMergeView } from "@/renderer/shared/model/merge-store";
import { MERGE_VIEW } from "@/renderer/shared/model/merge-state";
import { MergedPreviewPage } from "@/renderer/pages/merged-preview";

// TODO: 테스트용 - ErrorBoundary 동작 확인 후 제거
function CrashButton() {
  const [crash, setCrash] = useState(false);
  if (crash) throw new Error("테스트 에러: ErrorBoundary 동작 확인");
  return (
    <button
      onClick={() => setCrash(true)}
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        zIndex: 9999,
        background: "red",
        color: "white",
        padding: "4px 8px",
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      💥 에러 테스트
    </button>
  );
}

export function AppShell() {
  const view = useMergeView();

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      <CrashButton />
      {view === MERGE_VIEW.PREVIEW ? <AppToolbarPreview /> : <AppToolbar />}
      <main className="flex flex-1 overflow-hidden">
        {view === MERGE_VIEW.PREVIEW ? (
          <MergedPreviewPage />
        ) : (
          <MergeWorkspace />
        )}
      </main>
      <AppStatusBar />
      <MergeProgressOverlay />
    </div>
  );
}
