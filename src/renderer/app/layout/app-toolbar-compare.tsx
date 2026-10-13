import { ModeTabs } from "./mode-tabs";

/** 비교 화면 툴바(시안 3): 모드 탭, 제목, 안내. 최근 결과는 결과 화면(Step 27)과 함께 더한다. */
export function AppToolbarCompare() {
  return (
    <header className="border-border bg-card flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b px-6 py-2">
      <ModeTabs />
      <h1 className="ml-2 text-lg/6.5 font-semibold">새 비교</h1>
      <span className="text-muted-foreground text-xs/4.25">
        두 문서를 넣고 옵션을 정한 뒤 실행해요
      </span>
    </header>
  );
}
