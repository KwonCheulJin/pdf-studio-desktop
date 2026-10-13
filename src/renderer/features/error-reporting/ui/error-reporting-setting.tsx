import { useId } from "react";
import { Checkbox, SettingSection } from "@/renderer/shared/ui";
import { ERROR_REPORTING_SETTING_TEXT } from "../config/error-reporting-setting";
import {
  useErrorReportingStore,
  useIsErrorReportingEnabled
} from "../model/error-reporting-store";

interface DisclosureListProps {
  title: string;
  items: readonly string[];
}

function DisclosureList({ title, items }: DisclosureListProps) {
  return (
    <SettingSection title={title}>
      <ul className="text-muted-foreground list-disc pl-4.5 text-xs/4.5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </SettingSection>
  );
}

/**
 * 설정 › 오류 보고: 켜기·끄기(도구 막대의 오류 보고 버튼과 같은 설정)와 보내는 것·보내지 않는 것 안내.
 * 오류 보고 기능이 없는 빌드에서는 이 탭을 두지 않는다(조립하는 쪽이 판단한다).
 */
export function ErrorReportingSetting() {
  const descriptionId = useId();
  const isEnabled = useIsErrorReportingEnabled();
  const setEnabled = useErrorReportingStore((state) => state.setEnabled);

  return (
    <>
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox
          checked={isEnabled}
          onCheckedChange={(checked) => setEnabled(checked === true)}
          aria-describedby={descriptionId}
          className="mt-0.75"
        />
        <span>
          <span className="font-medium">
            {ERROR_REPORTING_SETTING_TEXT.ENABLE}
          </span>
          <span
            id={descriptionId}
            className="text-muted-foreground block text-xs/4.25"
          >
            {ERROR_REPORTING_SETTING_TEXT.ENABLE_DESCRIPTION}
          </span>
        </span>
      </label>
      <DisclosureList
        title={ERROR_REPORTING_SETTING_TEXT.SENT_TITLE}
        items={ERROR_REPORTING_SETTING_TEXT.SENT}
      />
      <DisclosureList
        title={ERROR_REPORTING_SETTING_TEXT.NOT_SENT_TITLE}
        items={ERROR_REPORTING_SETTING_TEXT.NOT_SENT}
      />
    </>
  );
}
