import { Button } from "@/renderer/shared/ui";
import { COMPARE_RESULT_TEXT } from "../config/compare-result";
import {
  useCompareSessionStore,
  useCompletedComparison
} from "../model/compare-session-store";

/**
 * 옵션 화면 머리의 "최근 결과"(시안 3). 남아 있는 결과가 있을 때만 보이고 결과 화면으로 돌아간다.
 * 슬롯 문서를 바꾸면 결과를 지우므로 사라진다.
 */
export function RecentResultButton() {
  const completed = useCompletedComparison();
  const showLastResult = useCompareSessionStore(
    (state) => state.showLastResult
  );
  if (!completed) return null;
  return (
    <Button
      variant="outline"
      onClick={showLastResult}
      className="bg-card h-8.5 rounded-md px-3 font-normal"
    >
      {COMPARE_RESULT_TEXT.RECENT_RESULT}
    </Button>
  );
}
