import { AppToolbar } from "./app-toolbar";
import { AppStatusBar } from "./app-status-bar";
import { MergeWorkspace } from "@/renderer/widgets/merge-workspace";

export function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppToolbar />
      <main className="flex flex-1 overflow-hidden">
        <MergeWorkspace />
      </main>
      <AppStatusBar />
    </div>
  );
}
