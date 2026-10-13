import { useEffect } from "react";
import { Toaster } from "sonner";
import { checkForUpdateOnce } from "@/renderer/features/app-update";
import { showErrorReportingNoticeOnce } from "@/renderer/features/error-reporting";
import { useThemeMode } from "@/renderer/features/theme-toggle";

/** 토스트도 앱 테마 설정(`system|light|dark`)을 따른다. */
export function AppToaster() {
  const mode = useThemeMode();

  // 토스트 라이브러리는 `Toaster`가 붙기 전에 띄운 토스트를 버린다. 붙은 뒤 첫 실행 안내를 띄우고
  // 업데이트를 확인한다.
  useEffect(() => {
    void showErrorReportingNoticeOnce();
    void checkForUpdateOnce();
  }, []);

  return <Toaster theme={mode} position="bottom-right" richColors />;
}
