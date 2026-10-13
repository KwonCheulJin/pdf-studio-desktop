import { ApiKeySetting } from "@/renderer/features/api-key";
import {
  ConfirmTransferSetting,
  DefaultModelSetting,
  SharedGlossarySetting
} from "@/renderer/features/translate-settings";
import { SETTINGS_TEXT } from "../config/settings-dialog";

interface TranslateTabProps {
  onEditGlossary: () => void;
}

/** 번역 탭(시안 14): API 키·기본 모델·외부 전송 확인·공용 용어집 */
export function TranslateTab({ onEditGlossary }: TranslateTabProps) {
  return (
    <>
      <ApiKeySetting />
      <DefaultModelSetting />
      <ConfirmTransferSetting />
      <SharedGlossarySetting onEdit={onEditGlossary} />
      <p className="text-muted-foreground text-xs/4.5">
        {SETTINGS_TEXT.USAGE_NOTE}
      </p>
    </>
  );
}
