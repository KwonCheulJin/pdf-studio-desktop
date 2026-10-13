import { ThirdPartyNoticesButton } from "@/renderer/features/third-party-notices";
import { APP_STATUS } from "@/renderer/shared/constants";

/**
 * 비교 화면 상태바(시안 3). 왼쪽의 A·B 쪽수는 파일 슬롯(Step 25)에서 쪽수를 읽은 뒤 채운다.
 */
export function AppCompareStatusBar() {
  return (
    <footer className="border-border bg-background flex h-10 shrink-0 items-center justify-end border-t px-6">
      <div className="text-muted-foreground flex items-center gap-3 text-sm">
        <span>상태: {APP_STATUS.READY}</span>
        <span className="text-muted-foreground/50">|</span>
        <span>v{__APP_VERSION__}</span>
        <ThirdPartyNoticesButton />
      </div>
    </footer>
  );
}
