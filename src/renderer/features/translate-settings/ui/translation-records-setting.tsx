import { useState } from "react";
import {
  Button,
  SETTING_BUTTON_CLASS,
  SettingRow,
  SettingSection
} from "@/renderer/shared/ui";
import { TRANSLATE_SETTINGS_TEXT } from "../config/translate-settings";
import { useTranslationRecordsClear } from "../model/use-translation-records-clear";

/** 저장된 번역(이어하기 기록) 모두 지우기. 지우기 전에 행 안에서 한 번 더 묻는다. */
export function TranslationRecordsSetting() {
  const [isConfirming, setIsConfirming] = useState(false);
  const { isClearing, clearRecords } = useTranslationRecordsClear();

  const handleClear = async () => {
    if (await clearRecords()) setIsConfirming(false);
  };

  return (
    <SettingSection title={TRANSLATE_SETTINGS_TEXT.RECORDS}>
      <SettingRow>
        {isConfirming ? (
          <>
            <span>{TRANSLATE_SETTINGS_TEXT.RECORDS_CLEAR_CONFIRM}</span>
            <span className="grow" />
            <Button
              variant="ghost"
              disabled={isClearing}
              onClick={() => void handleClear()}
              className={SETTING_BUTTON_CLASS.DESTRUCTIVE}
            >
              {TRANSLATE_SETTINGS_TEXT.RECORDS_CLEAR_ACTION}
            </Button>
            <Button
              variant="outline"
              disabled={isClearing}
              onClick={() => setIsConfirming(false)}
              className={SETTING_BUTTON_CLASS.OUTLINE}
            >
              {TRANSLATE_SETTINGS_TEXT.CANCEL}
            </Button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground min-w-0 flex-1 text-xs/4.5">
              {TRANSLATE_SETTINGS_TEXT.RECORDS_DESCRIPTION}
            </span>
            <Button
              variant="ghost"
              onClick={() => setIsConfirming(true)}
              className={SETTING_BUTTON_CLASS.DESTRUCTIVE}
            >
              {TRANSLATE_SETTINGS_TEXT.RECORDS_CLEAR}
            </Button>
          </>
        )}
      </SettingRow>
    </SettingSection>
  );
}
