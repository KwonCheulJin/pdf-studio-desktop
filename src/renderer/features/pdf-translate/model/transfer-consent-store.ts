import { create } from "zustand";
import { getPlatform, LOG_LEVEL } from "@/renderer/shared/platform";
import { TRANSFER_CONFIRMED_ONCE_SETTING } from "../config/translate-options";

interface TransferConsentState {
  /**
   * 키를 등록한 뒤 외부 전송 확인을 한 번 받았는가(ADR 0002 §13, 설정 `translate.transferConfirmedOnce`).
   * 읽기 전에는 `null`(확인을 받는 쪽으로 본다). 키를 저장하면 Rust가 `false`로 되돌린다.
   */
  isConfirmedOnce: boolean | null;
}

export const useTransferConsentStore = create<TransferConsentState>(() => ({
  isConfirmedOnce: null
}));

/** 설정 저장소에서 다시 읽는다. 없거나 모르는 값이면 `false`(첫 번역) */
export async function loadTransferConfirmedOnce(): Promise<void> {
  try {
    const stored = await getPlatform().getSetting(
      TRANSFER_CONFIRMED_ONCE_SETTING
    );
    useTransferConsentStore.setState({ isConfirmedOnce: stored === true });
  } catch (error) {
    getPlatform().log({
      level: LOG_LEVEL.WARN,
      message: `외부 전송 확인 기록 읽기 실패: ${String(error)}`
    });
    useTransferConsentStore.setState({ isConfirmedOnce: false });
  }
}

/** 동의 체크를 받은 채 번역을 시작하면 기록한다(ADR 0002 §13). */
export function markTransferConfirmedOnce(): void {
  useTransferConsentStore.setState({ isConfirmedOnce: true });
  getPlatform()
    .setSetting({ key: TRANSFER_CONFIRMED_ONCE_SETTING, value: true })
    .catch((error: unknown) => {
      getPlatform().log({
        level: LOG_LEVEL.WARN,
        message: `외부 전송 확인 기록 저장 실패: ${String(error)}`
      });
    });
}

interface ConsentRequirementParams {
  /** 설정 "번역 전에 외부 전송 확인 받기" */
  confirmExternalTransfer: boolean;
  isConfirmedOnce: boolean | null;
}

/** 실행 전 확인에서 동의 체크를 받아야 하는가(ADR 0002 §13 표) */
export function isTransferConsentRequired({
  confirmExternalTransfer,
  isConfirmedOnce
}: ConsentRequirementParams): boolean {
  return confirmExternalTransfer || isConfirmedOnce !== true;
}
