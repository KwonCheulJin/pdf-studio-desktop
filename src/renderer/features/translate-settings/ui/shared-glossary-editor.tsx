import { GlossaryTable } from "@/renderer/entities/glossary";
import { TRANSLATE_SETTINGS_TEXT } from "../config/translate-settings";
import { useTranslateSettingsStore } from "../model/translate-settings-store";

/** 공용 용어집 표 편집(바꾸면 바로 저장). 번역 옵션 화면의 용어 표와 같은 컴포넌트다. */
export function SharedGlossaryEditor() {
  const rows = useTranslateSettingsStore((state) => state.glossaryRows);
  const setRows = useTranslateSettingsStore((state) => state.setGlossaryRows);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs/4.5">
        {TRANSLATE_SETTINGS_TEXT.GLOSSARY_EDITOR_DESCRIPTION}
      </p>
      <GlossaryTable rows={rows} onRowsChange={setRows} />
    </div>
  );
}
