import { ThirdPartyNoticesButton } from "@/renderer/features/third-party-notices";

const HOME_STATUS_TEXT = "준비됨";

/** 홈 상태바(시안 1): 상태와 버전. 오픈소스 라이선스는 모든 화면 상태바에 둔다. */
export function AppHomeStatusBar() {
  return (
    <footer className="border-border text-muted-foreground flex h-7 shrink-0 items-center gap-4 border-t px-4 text-xs">
      <span>{HOME_STATUS_TEXT}</span>
      <span className="grow" />
      <span className="font-mono">v{__APP_VERSION__}</span>
      <ThirdPartyNoticesButton />
    </footer>
  );
}
