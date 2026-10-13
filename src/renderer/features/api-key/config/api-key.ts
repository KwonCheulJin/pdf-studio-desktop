import type { ErrorCode } from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";

/**
 * 입력을 멈춘 뒤 키 확인을 부르기까지 기다리는 시간. 붙여 넣으면 기다리지 않는다(계획서 P6-8).
 * 키를 한 글자씩 칠 때마다 Anthropic에 묻지 않을 만큼만 둔다.
 */
export const API_KEY_CHECK_DELAY_MS = 600;

/** 키 확인 상태(시안 11 입력 칸 아래 문구) */
export const API_KEY_CHECK_STATUS = {
  IDLE: "idle",
  CHECKING: "checking",
  VERIFIED: "verified",
  FAILED: "failed"
} as const;

export type ApiKeyCheckStatus = ValueOf<typeof API_KEY_CHECK_STATUS>;

/** 형식이 틀린 키(네트워크로 묻지 않고 화면이 먼저 알린다, Rust와 같은 코드) */
export const API_KEY_INVALID_CODE = "API_KEY_INVALID" satisfies ErrorCode;

/** 등록된 키 힌트(끝 4자리) 앞에 보이는 가림 글자 */
export const API_KEY_MASK = "····";

export const API_KEY_TEXT = {
  DIALOG_TITLE: "Claude API 키 등록",
  DIALOG_DESCRIPTION:
    "번역은 내 Claude API 키로 실행돼요. 사용한 토큰만큼 내 Anthropic 계정에 요금이 청구돼요.",
  STEP: "브라우저에서 아래 주소를 열고 키를 만든 뒤 복사하세요.",
  CONSOLE_KEYS_ADDRESS: "platform.claude.com/settings/keys",
  INPUT_LABEL: "API 키",
  SHOW_KEY: "키 보이기",
  HIDE_KEY: "키 가리기",
  CHECKING: "키를 확인하는 중…",
  VERIFIED: "키를 확인했어요. 저장하면 번역을 시작할 수 있어요.",
  NOTES: [
    "키는 이 컴퓨터의 키체인에만 저장되고, 저장한 뒤에는 끝 4자리만 보여요.",
    "번역할 때 문서 내용이 Anthropic API로 전송돼요.",
    "설정 › 번역에서 언제든 바꾸거나 지울 수 있어요."
  ],
  CANCEL: "취소",
  SAVE: "저장",
  SAVED: "API 키를 저장했어요.",
  SETTING_TITLE: "Claude API 키",
  REGISTERED: "등록됨",
  NOT_REGISTERED: "등록 안 됨",
  STORED_IN_KEYCHAIN: "· 키체인에 저장",
  LOADING: "확인하는 중…",
  CHANGE: "바꾸기",
  REGISTER: "등록",
  DELETE: "삭제",
  DELETE_CONFIRM: "키를 지울까요?",
  DELETE_ACTION: "지우기",
  DELETE_FAILED: "API 키를 지우지 못했어요.",
  STATUS_FAILED: "API 키 상태를 읽지 못했어요."
} as const;
