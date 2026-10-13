import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { ApiKeyStatus } from "@/renderer/shared/api/bindings";
import {
  Button,
  SETTING_BUTTON_CLASS,
  SettingRow,
  SettingSection
} from "@/renderer/shared/ui";
import { API_KEY_TEXT } from "../config/api-key";
import { formatApiKeyHint } from "../lib/api-key-format";
import { loadApiKeyStatus, useApiKeyStatus } from "../model/api-key-store";
import { useApiKeyDelete } from "../model/use-api-key-delete";
import { ApiKeyDialog } from "./api-key-dialog";

const CHECK_ICON_SIZE = 16;
/** 시안 14 ✓ 굵기 */
const CHECK_STROKE_WIDTH = 2.5;

interface RegisteredKeyProps {
  status: ApiKeyStatus;
  onChange: () => void;
}

/** 등록된 키: ✓ 등록됨 + 끝 4자리 힌트 + 바꾸기·삭제(삭제는 행 안에서 한 번 더 묻는다) */
function RegisteredKey({ status, onChange }: RegisteredKeyProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const { isDeleting, deleteKey } = useApiKeyDelete();

  if (isConfirmingDelete) {
    return (
      <>
        <span>{API_KEY_TEXT.DELETE_CONFIRM}</span>
        <span className="grow" />
        <Button
          variant="ghost"
          disabled={isDeleting}
          onClick={() => void deleteKey()}
          className={SETTING_BUTTON_CLASS.DESTRUCTIVE}
        >
          {API_KEY_TEXT.DELETE_ACTION}
        </Button>
        <Button
          variant="outline"
          disabled={isDeleting}
          onClick={() => setIsConfirmingDelete(false)}
          className={SETTING_BUTTON_CLASS.OUTLINE}
        >
          {API_KEY_TEXT.CANCEL}
        </Button>
      </>
    );
  }

  return (
    <>
      <Check
        size={CHECK_ICON_SIZE}
        strokeWidth={CHECK_STROKE_WIDTH}
        className="text-success shrink-0"
        aria-hidden="true"
      />
      <span>{API_KEY_TEXT.REGISTERED}</span>
      {status.hint !== null && (
        <span className="text-muted-foreground font-mono">
          {formatApiKeyHint(status.hint)}
        </span>
      )}
      <span className="text-muted-foreground text-xs">
        {API_KEY_TEXT.STORED_IN_KEYCHAIN}
      </span>
      <span className="grow" />
      <Button
        variant="outline"
        onClick={onChange}
        className={SETTING_BUTTON_CLASS.OUTLINE}
      >
        {API_KEY_TEXT.CHANGE}
      </Button>
      <Button
        variant="ghost"
        onClick={() => setIsConfirmingDelete(true)}
        className={SETTING_BUTTON_CLASS.DESTRUCTIVE}
      >
        {API_KEY_TEXT.DELETE}
      </Button>
    </>
  );
}

/** 설정 › 번역의 "Claude API 키" 행(시안 14). 바꾸기·등록은 키 모달(시안 11)을 연다. */
export function ApiKeySetting() {
  const status = useApiKeyStatus();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // 설정을 열 때마다 힌트를 다시 읽는다(키체인은 읽지 않는다).
  useEffect(() => {
    void loadApiKeyStatus();
  }, []);

  const renderContent = () => {
    if (status === null) {
      return (
        <span className="text-muted-foreground">{API_KEY_TEXT.LOADING}</span>
      );
    }
    if (status.registered) {
      return (
        <RegisteredKey status={status} onChange={() => setIsDialogOpen(true)} />
      );
    }
    return (
      <>
        <span>{API_KEY_TEXT.NOT_REGISTERED}</span>
        <span className="grow" />
        <Button
          variant="outline"
          onClick={() => setIsDialogOpen(true)}
          className={SETTING_BUTTON_CLASS.OUTLINE}
        >
          {API_KEY_TEXT.REGISTER}
        </Button>
      </>
    );
  };

  return (
    <SettingSection title={API_KEY_TEXT.SETTING_TITLE}>
      <SettingRow>{renderContent()}</SettingRow>
      <ApiKeyDialog isOpen={isDialogOpen} onOpenChange={setIsDialogOpen} />
    </SettingSection>
  );
}
