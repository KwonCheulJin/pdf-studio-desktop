import { useId } from "react";
import { Checkbox } from "@/renderer/shared/ui";
import { TRANSLATE_SETTINGS_TEXT } from "../config/translate-settings";
import { useTranslateSettingsStore } from "../model/translate-settings-store";

/** 번역 전에 외부 전송 확인을 받을지(Q11, ADR 0002 §13). 기본은 켬 */
export function ConfirmTransferSetting() {
  const descriptionId = useId();
  const isConfirmed = useTranslateSettingsStore(
    (state) => state.confirmExternalTransfer
  );
  const setConfirmed = useTranslateSettingsStore(
    (state) => state.setConfirmExternalTransfer
  );

  return (
    <label className="flex cursor-pointer items-start gap-3">
      <Checkbox
        checked={isConfirmed}
        onCheckedChange={(checked) => setConfirmed(checked === true)}
        aria-describedby={descriptionId}
        className="mt-0.75"
      />
      <span>
        <span className="font-medium">
          {TRANSLATE_SETTINGS_TEXT.CONFIRM_TRANSFER}
        </span>
        <span
          id={descriptionId}
          className="text-muted-foreground block text-xs/4.25"
        >
          {TRANSLATE_SETTINGS_TEXT.CONFIRM_TRANSFER_DESCRIPTION}
        </span>
      </span>
    </label>
  );
}
