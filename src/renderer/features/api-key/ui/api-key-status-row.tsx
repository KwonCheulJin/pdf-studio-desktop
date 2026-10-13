import { Check } from "lucide-react";
import type { ApiKeyStatus } from "@/renderer/shared/api/bindings";
import { API_KEY_MASK, API_KEY_TEXT } from "../config/api-key";

const CHECK_ICON_SIZE = 16;
/** 시안 10 ✓ 굵기 */
const CHECK_STROKE_WIDTH = 2.5;

const LINK_BUTTON_CLASS =
  "text-primary focus-visible:ring-ring rounded-xs text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none";

interface ApiKeyStatusRowProps {
  /** 읽기 전이면 `null` */
  status: ApiKeyStatus | null;
  /** "바꾸기"·"등록"을 누르면 키 모달을 연다. */
  onOpenDialog: () => void;
}

/** 번역 실행 전 확인 카드의 키 행(시안 10): `✓ API 키 등록됨 ····a1F3` + "바꾸기" / "API 키 없음" + "등록" */
export function ApiKeyStatusRow({
  status,
  onOpenDialog
}: ApiKeyStatusRowProps) {
  if (status === null) {
    return (
      <div className="text-muted-foreground flex items-center text-[13px]">
        {API_KEY_TEXT.LOADING}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[13px]">
      {status.registered ? (
        <>
          <Check
            size={CHECK_ICON_SIZE}
            strokeWidth={CHECK_STROKE_WIDTH}
            className="text-success shrink-0"
            aria-hidden="true"
          />
          <span>{API_KEY_TEXT.ROW_REGISTERED}</span>
          {status.hint !== null && (
            <span className="text-muted-foreground font-mono">
              {`${API_KEY_MASK}${status.hint}`}
            </span>
          )}
        </>
      ) : (
        <span>{API_KEY_TEXT.ROW_MISSING}</span>
      )}
      <span className="grow" />
      <button
        type="button"
        onClick={onOpenDialog}
        className={LINK_BUTTON_CLASS}
      >
        {status.registered ? API_KEY_TEXT.CHANGE : API_KEY_TEXT.REGISTER}
      </button>
    </div>
  );
}
