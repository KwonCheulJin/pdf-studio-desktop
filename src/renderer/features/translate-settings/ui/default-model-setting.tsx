import { SegmentedControl, SettingSection } from "@/renderer/shared/ui";
import {
  MODEL_OPTIONS,
  TRANSLATE_SETTINGS_TEXT
} from "../config/translate-settings";
import { useTranslateSettingsStore } from "../model/translate-settings-store";

/** 번역 옵션 화면이 처음 고를 모델 */
export function DefaultModelSetting() {
  const defaultModel = useTranslateSettingsStore((state) => state.defaultModel);
  const setDefaultModel = useTranslateSettingsStore(
    (state) => state.setDefaultModel
  );

  return (
    <SettingSection title={TRANSLATE_SETTINGS_TEXT.DEFAULT_MODEL}>
      <SegmentedControl
        label={TRANSLATE_SETTINGS_TEXT.DEFAULT_MODEL}
        options={MODEL_OPTIONS}
        value={defaultModel}
        onChange={setDefaultModel}
      />
    </SettingSection>
  );
}
