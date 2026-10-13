import { useTranslateFile } from "@/renderer/features/pdf-translate";
import { ThirdPartyNoticesButton } from "@/renderer/features/third-party-notices";
import { APP_STATUS } from "@/renderer/shared/constants";
import { CompareRunIndicator } from "./compare-run-indicator";

const EMPTY_FILE_TEXT = "비어 있음";

/** 번역 화면 상태바(시안 10): 왼쪽에 쪽수(파일이 없으면 "비어 있음"), 오른쪽에 상태·버전 */
export function AppTranslateStatusBar() {
  const file = useTranslateFile();
  return (
    <footer className="border-border bg-background text-muted-foreground flex h-10 shrink-0 items-center justify-between gap-4 border-t px-6 text-sm">
      <span>{file ? `${file.pageCount}쪽` : EMPTY_FILE_TEXT}</span>
      <div className="flex items-center gap-3">
        <CompareRunIndicator />
        <span>상태: {APP_STATUS.READY}</span>
        <span className="text-muted-foreground/50">|</span>
        <span>v{__APP_VERSION__}</span>
        <ThirdPartyNoticesButton />
      </div>
    </footer>
  );
}
