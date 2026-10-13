interface SteppedParagraphParams {
  /** 보고 있는 쪽의 문단 키(쪽 안 순서) */
  keys: readonly string[];
  activeKey: string | null;
  /** 앞(-1)·뒤(+1) */
  step: number;
}

const NOT_FOUND = -1;
const FIRST_INDEX = 0;
const LAST_INDEX_OFFSET = 1;

/**
 * ↑↓로 고를 다음 문단 키. 고른 문단이 없거나 이 쪽에 없으면 ↓는 첫 문단, ↑는 끝 문단이다.
 * 쪽 끝에서는 그대로 둔다(쪽은 ←→로 옮긴다). 문단이 없으면 `null`
 */
export function steppedParagraphKey({
  keys,
  activeKey,
  step
}: SteppedParagraphParams): string | null {
  if (keys.length === 0) return null;
  const lastIndex = keys.length - LAST_INDEX_OFFSET;
  const index = activeKey === null ? NOT_FOUND : keys.indexOf(activeKey);
  if (index === NOT_FOUND) {
    return keys[step > 0 ? FIRST_INDEX : lastIndex];
  }
  const nextIndex = Math.min(lastIndex, Math.max(FIRST_INDEX, index + step));
  return keys[nextIndex];
}
