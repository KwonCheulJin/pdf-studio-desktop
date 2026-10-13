import { ModeTabs } from "./mode-tabs";
import { SettingsButton } from "./settings-button";

interface AppToolbarTranslateProps {
  onOpenSettings: () => void;
}

/** 번역 화면 툴바(시안 10 머리): 모드 탭 다음에 제목 "새 번역"과 안내, 오른쪽 설정 톱니 */
export function AppToolbarTranslate({
  onOpenSettings
}: AppToolbarTranslateProps) {
  return (
    <header className="border-border bg-card flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b px-6 py-2">
      <ModeTabs />
      <h1 className="ml-2 text-lg/6.5 font-semibold">새 번역</h1>
      <span className="text-muted-foreground text-xs/4.25">
        중국어·영어 PDF를 한국어로
      </span>
      <SettingsButton onClick={onOpenSettings} />
    </header>
  );
}
