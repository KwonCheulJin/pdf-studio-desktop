import {
  normalizeGlossary,
  toGlossaryTerms
} from "@/renderer/entities/glossary";
import {
  Button,
  SETTING_BUTTON_CLASS,
  SettingRow,
  SettingSection
} from "@/renderer/shared/ui";
import {
  TRANSLATE_SETTINGS_TEXT,
  translateSettingsText
} from "../config/translate-settings";
import { useTranslateSettingsStore } from "../model/translate-settings-store";

interface SharedGlossarySettingProps {
  /** "편집"을 누르면 같은 모달 안에서 용어 표를 연다. */
  onEdit: () => void;
}

/** 공용 용어집 요약: 번역에 실리는 용어 수와 "편집" */
export function SharedGlossarySetting({ onEdit }: SharedGlossarySettingProps) {
  const termCount = useTranslateSettingsStore(
    (state) => normalizeGlossary(toGlossaryTerms(state.glossaryRows)).length
  );

  return (
    <SettingSection title={TRANSLATE_SETTINGS_TEXT.GLOSSARY}>
      <SettingRow>
        <span>{translateSettingsText.glossaryCount(termCount)}</span>
        <span className="text-muted-foreground text-xs">
          {TRANSLATE_SETTINGS_TEXT.GLOSSARY_APPLIES}
        </span>
        <span className="grow" />
        <Button
          variant="outline"
          onClick={onEdit}
          className={SETTING_BUTTON_CLASS.OUTLINE}
        >
          {TRANSLATE_SETTINGS_TEXT.GLOSSARY_EDIT}
        </Button>
      </SettingRow>
    </SettingSection>
  );
}
