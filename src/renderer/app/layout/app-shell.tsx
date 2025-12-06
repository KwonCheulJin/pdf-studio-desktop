import { AppToolbar } from "./app-toolbar";
import { AppStatusBar } from "./app-status-bar";
import { MergeWorkspace } from "@/renderer/widgets/merge-workspace";

export function AppShell() {
  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      <AppToolbar />
      <main className="flex flex-1 overflow-hidden">
        <MergeWorkspace />
      </main>
      <AppStatusBar />
    </div>
  );
}
