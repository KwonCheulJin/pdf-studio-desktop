import { useCompareRunStatus } from "@/renderer/features/pdf-compare";
import { ModeTabs } from "./mode-tabs";

interface ToolbarHeading {
  title: string;
  hint: string;
}

const IDLE_HEADING: ToolbarHeading = {
  title: "새 비교",
  hint: "두 문서를 넣고 옵션을 정한 뒤 실행해요"
};

const RUNNING_HEADING: ToolbarHeading = {
  title: "비교하는 중",
  hint: "다른 화면으로 가도 계속 진행돼요"
};

/**
 * 비교 화면 툴바(시안 3·9): 모드 탭, 제목, 안내. 실행 중이면 "비교하는 중". 최근 결과는
 * 결과 화면(Step 27)과 함께 더한다.
 */
export function AppToolbarCompare() {
  const { isRunning } = useCompareRunStatus();
  const { title, hint } = isRunning ? RUNNING_HEADING : IDLE_HEADING;
  return (
    <header className="border-border bg-card flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b px-6 py-2">
      <ModeTabs />
      <h1 className="ml-2 text-lg/6.5 font-semibold">{title}</h1>
      <span className="text-muted-foreground text-xs/4.25">{hint}</span>
    </header>
  );
}
