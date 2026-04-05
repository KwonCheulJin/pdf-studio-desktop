import { AppToolbar } from "./app-toolbar";
import { AppToolbarPreview } from "./app-toolbar-preview";
import { AppStatusBar } from "./app-status-bar";
import { MergeWorkspace } from "@/renderer/widgets/merge-workspace";
import { MergeProgressOverlay } from "@/renderer/shared/ui";
import { useMergeView } from "@/renderer/shared/model/merge-store";
import { MERGE_VIEW } from "@/renderer/shared/model/merge-state";
import { MergedPreviewPage } from "@/renderer/pages/merged-preview";

export function AppShell() {
  const view = useMergeView();

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
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
