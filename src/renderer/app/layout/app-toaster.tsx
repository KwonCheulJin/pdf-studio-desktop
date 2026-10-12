import { useEffect } from "react";
import { Toaster } from "sonner";
import { showErrorReportingNoticeOnce } from "@/renderer/features/error-reporting";
import { useThemeMode } from "@/renderer/features/theme-toggle";

/** 토스트도 앱 테마 설정(`system|light|dark`)을 따른다. */
export function AppToaster() {
  const mode = useThemeMode();

  // 토스트 라이브러리는 `Toaster`가 붙기 전에 띄운 토스트를 버린다. 붙은 뒤 첫 실행 안내를 띄운다.
  useEffect(() => {
    void showErrorReportingNoticeOnce();
  }, []);

  return <Toaster theme={mode} position="bottom-right" richColors />;
}
