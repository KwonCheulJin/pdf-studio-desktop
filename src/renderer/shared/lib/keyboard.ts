const MAC_USER_AGENT_TOKEN = "Mac";

const IS_MAC = navigator.userAgent.includes(MAC_USER_AGENT_TOKEN);

const EDITABLE_TAG_NAMES = new Set(["INPUT", "TEXTAREA", "SELECT"]);

interface ModifierKeyState {
  metaKey: boolean;
  ctrlKey: boolean;
}

/** 단축키의 주 보조키: macOS는 ⌘, 그 밖은 Ctrl */
export function isPrimaryModifierPressed(event: ModifierKeyState): boolean {
  return IS_MAC ? event.metaKey : event.ctrlKey;
}

/** 글자를 입력받는 요소인지. 여기서 누른 키는 앱 단축키로 가로채지 않는다. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || EDITABLE_TAG_NAMES.has(target.tagName);
}
