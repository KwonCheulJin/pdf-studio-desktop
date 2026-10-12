import { Bug, BugOff } from "lucide-react";
import { isErrorReportingAvailable } from "@/renderer/shared/lib/error-report";
import { Button, Tooltip } from "@/renderer/shared/ui";
import {
  useErrorReportingStore,
  useIsErrorReportingEnabled
} from "../model/error-reporting-store";

/** 오류 보고 켜기·끄기. 오류 보고 기능이 없는 빌드에서는 보이지 않는다. */
export function ErrorReportingToggleButton() {
  const isEnabled = useIsErrorReportingEnabled();
  const setEnabled = useErrorReportingStore((state) => state.setEnabled);

  if (!isErrorReportingAvailable()) return null;

  return (
    <Tooltip content={isEnabled ? "오류 보고: 켜짐" : "오류 보고: 꺼짐"}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setEnabled(!isEnabled)}
        aria-label="오류 보고"
        aria-pressed={isEnabled}
      >
        {isEnabled ? <Bug size={16} /> : <BugOff size={16} />}
      </Button>
    </Tooltip>
  );
}
