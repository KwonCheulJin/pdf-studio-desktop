import {
  TRANSLATE_PROGRESS_TEXT,
  TRANSLATE_SCREEN,
  TranslateResultHeading,
  useTranslateRunStatus,
  useTranslateScreen
} from "@/renderer/features/pdf-translate";
import { ModeTabs } from "./mode-tabs";
import { SettingsButton } from "./settings-button";

interface AppToolbarTranslateProps {
  onOpenSettings: () => void;
}

interface ToolbarHeading {
  title: string;
  hint: string;
}

const IDLE_HEADING: ToolbarHeading = {
  title: "새 번역",
  hint: "중국어·영어 PDF를 한국어로"
};

const RUNNING_HEADING: ToolbarHeading = {
  title: TRANSLATE_PROGRESS_TEXT.RUNNING_TITLE,
  hint: TRANSLATE_PROGRESS_TEXT.RUNNING_HINT
};

/**
 * 번역 화면 툴바(시안 10·12·13 머리): 모드 탭 다음에, 결과 화면이면 결과 머리(뒤로·제목·언어·모델·쪽·
 * 걸린 시간·새 번역), 아니면 제목·안내("새 번역", 실행 중이면 "번역하는 중"). 오른쪽 설정 톱니
 */
export function AppToolbarTranslate({
  onOpenSettings
}: AppToolbarTranslateProps) {
  const { isRunning } = useTranslateRunStatus();
  const screen = useTranslateScreen();
  const { title, hint } = isRunning ? RUNNING_HEADING : IDLE_HEADING;
  return (
    <header className="border-border bg-card flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b px-6 py-2">
      <ModeTabs />
      {screen === TRANSLATE_SCREEN.RESULT ? (
        <TranslateResultHeading />
      ) : (
        <>
          <h1 className="ml-2 text-lg/6.5 font-semibold">{title}</h1>
          <span className="text-muted-foreground text-xs/4.25">{hint}</span>
        </>
      )}
      <SettingsButton onClick={onOpenSettings} />
    </header>
  );
}
