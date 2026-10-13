import { useId, useState } from "react";
import { AlertCircle, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/renderer/shared/lib/utils";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/renderer/shared/ui";
import {
  API_KEY_CHECK_STATUS,
  API_KEY_TEXT,
  type ApiKeyCheckStatus
} from "../config/api-key";
import { useApiKeyForm } from "../model/use-api-key-form";

const STATUS_ICON_SIZE = 14;
const EYE_ICON_SIZE = 16;

const INPUT_BORDER_CLASS: Record<ApiKeyCheckStatus, string> = {
  [API_KEY_CHECK_STATUS.IDLE]: "border-input",
  [API_KEY_CHECK_STATUS.CHECKING]: "border-input",
  [API_KEY_CHECK_STATUS.VERIFIED]: "border-success",
  [API_KEY_CHECK_STATUS.FAILED]: "border-destructive"
};

interface KeyStatusLineProps {
  id: string;
  status: ApiKeyCheckStatus;
  /** 확인·저장 실패 문구. 있으면 실패로 보인다. */
  errorMessage: string | null;
}

/** 입력 칸 아래 확인 상태(확인 중·성공·실패 코드 문구). 바뀌면 화면 읽기 프로그램이 읽는다. */
function KeyStatusLine({ id, status, errorMessage }: KeyStatusLineProps) {
  const renderContent = () => {
    if (errorMessage !== null) {
      return (
        <span className="text-destructive flex items-start gap-1.5">
          <AlertCircle
            size={STATUS_ICON_SIZE}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {errorMessage}
        </span>
      );
    }
    if (status === API_KEY_CHECK_STATUS.CHECKING) {
      return (
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Loader2
            size={STATUS_ICON_SIZE}
            className="animate-spin"
            aria-hidden="true"
          />
          {API_KEY_TEXT.CHECKING}
        </span>
      );
    }
    if (status === API_KEY_CHECK_STATUS.VERIFIED) {
      return (
        <span className="text-success-subtle-foreground flex items-center gap-1.5">
          <Check size={STATUS_ICON_SIZE} aria-hidden="true" />
          {API_KEY_TEXT.VERIFIED}
        </span>
      );
    }
    return null;
  };

  return (
    <span id={id} role="status" className="min-h-4.25 text-xs/4.25">
      {renderContent()}
    </span>
  );
}

interface ApiKeyFormProps {
  onClose: () => void;
}

/** 모달 안 내용. 모달이 닫히면 함께 사라져 입력한 키가 남지 않는다. */
function ApiKeyForm({ onClose }: ApiKeyFormProps) {
  const inputId = useId();
  const statusId = useId();
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const {
    key,
    check,
    saveErrorMessage,
    canSave,
    handleKeyChange,
    handlePaste,
    saveKey
  } = useApiKeyForm();
  const errorMessage = saveErrorMessage ?? check.errorMessage;
  const borderStatus =
    saveErrorMessage === null ? check.status : API_KEY_CHECK_STATUS.FAILED;

  const handleSave = async () => {
    if (await saveKey()) onClose();
  };

  return (
    <>
      <div className="flex flex-col gap-1.5 px-7 pt-5.5">
        <DialogTitle className="text-lg/6.5 font-semibold">
          {API_KEY_TEXT.DIALOG_TITLE}
        </DialogTitle>
        <DialogDescription className="text-sm/5.25">
          {API_KEY_TEXT.DIALOG_DESCRIPTION}
        </DialogDescription>
      </div>

      <div className="flex flex-col gap-3.5 px-7 pt-4.5 pb-5">
        <div className="bg-card-inset border-border flex gap-2.5 rounded-md border px-3.5 py-3 text-[13px]/4.75">
          <span
            aria-hidden="true"
            className="bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          >
            1
          </span>
          <span>
            {API_KEY_TEXT.STEP}
            <br />
            <span className="font-mono text-xs select-all">
              {API_KEY_TEXT.CONSOLE_KEYS_ADDRESS}
            </span>
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-[13px] font-semibold">
            {API_KEY_TEXT.INPUT_LABEL}
          </label>
          <div
            className={cn(
              "focus-within:ring-ring flex h-10 items-center gap-1.5 rounded-md border pr-1.5 pl-3 focus-within:ring-2",
              INPUT_BORDER_CLASS[borderStatus]
            )}
          >
            <input
              id={inputId}
              type={isKeyVisible ? "text" : "password"}
              value={key}
              onChange={(event) => handleKeyChange(event.target.value)}
              onPaste={handlePaste}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={statusId}
              aria-invalid={errorMessage !== null}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none"
            />
            <button
              type="button"
              onClick={() => setIsKeyVisible((isVisible) => !isVisible)}
              aria-label={
                isKeyVisible ? API_KEY_TEXT.HIDE_KEY : API_KEY_TEXT.SHOW_KEY
              }
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              {isKeyVisible ? (
                <EyeOff size={EYE_ICON_SIZE} aria-hidden="true" />
              ) : (
                <Eye size={EYE_ICON_SIZE} aria-hidden="true" />
              )}
            </button>
          </div>
          <KeyStatusLine
            id={statusId}
            status={check.status}
            errorMessage={errorMessage}
          />
        </div>

        <ul className="text-muted-foreground list-disc pl-4.5 text-xs/4.5">
          {API_KEY_TEXT.NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      <div className="border-border flex justify-end gap-2 border-t px-7 pt-3.5 pb-5.5">
        <Button
          variant="outline"
          onClick={onClose}
          className="bg-card h-9.5 rounded-md px-4 font-normal"
        >
          {API_KEY_TEXT.CANCEL}
        </Button>
        <Button
          disabled={!canSave}
          onClick={() => void handleSave()}
          className="h-9.5 rounded-md px-4.5 font-medium"
        >
          {API_KEY_TEXT.SAVE}
        </Button>
      </div>
    </>
  );
}

interface ApiKeyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * Claude API 키 등록·바꾸기 모달(시안 11, 520px). 확인에 성공한 키만 저장하고, 저장하면 닫힌다.
 * Esc·취소로 닫으면 입력한 키를 버린다.
 */
export function ApiKeyDialog({ isOpen, onOpenChange }: ApiKeyDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="bg-card flex max-w-[calc(100%-3rem)] flex-col gap-0 rounded-xl border-0 p-0 text-sm/5.25 shadow-xl sm:max-w-130"
      >
        <ApiKeyForm onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
