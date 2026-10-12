import { useShallow } from "zustand/react/shallow";
import { MergedPreviewPage } from "@/renderer/pages/merged-preview";
import { MergeWorkspace } from "@/renderer/widgets/merge-workspace";
import {
  MERGE_VIEW,
  MergeProgressOverlay,
  useMergeStore,
  useMergeView
} from "@/renderer/entities/merge-plan";
import { usePdfDocumentRetention } from "@/renderer/shared/lib/pdfjs";
import { AppToolbar } from "./app-toolbar";
import { AppToolbarPreview } from "./app-toolbar-preview";
import { AppStatusBar } from "./app-status-bar";

export function AppShell() {
  const view = useMergeView();
  // 작업 공간에 있는 파일은 화면(카드·미리보기·병합 결과 보기)을 오가도 다시 읽지 않는다.
  // 파일을 빼면 놓아서 문서를 닫고 렌더 캐시를 비운다.
  const sourcePaths = useMergeStore(
    useShallow((state) => state.files.map((file) => file.path))
  );
  usePdfDocumentRetention(sourcePaths);

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
