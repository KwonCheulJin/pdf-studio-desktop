import {
  API_KEY_MAX_LEN,
  API_KEY_PREFIX
} from "@/renderer/shared/api/bindings";
import { API_KEY_MASK } from "../config/api-key";

/** 키에 쓸 수 있는 글자: ASCII 그래픽 글자(공백·제어 문자 없음, ADR 0002 §12) */
const API_KEY_CHARACTERS = /^[\x21-\x7E]+$/;

/**
 * 네트워크로 확인하기 전의 형식 검사(ADR 0002 §12, Rust와 같은 규칙): 앞뒤 공백을 지운 키가
 * `API_KEY_PREFIX`로 시작하고 `API_KEY_MAX_LEN` 이하이며 ASCII 그래픽 글자만이다.
 */
export function isWellFormedApiKey(trimmedKey: string): boolean {
  return (
    trimmedKey.startsWith(API_KEY_PREFIX) &&
    trimmedKey.length <= API_KEY_MAX_LEN &&
    API_KEY_CHARACTERS.test(trimmedKey)
  );
}

/** 등록된 키 표시: 접두어 + 가림 글자 + 끝 4자리 힌트(시안 14 `sk-ant-····a1F3`) */
export function formatApiKeyHint(hint: string): string {
  return `${API_KEY_PREFIX}${API_KEY_MASK}${hint}`;
}
