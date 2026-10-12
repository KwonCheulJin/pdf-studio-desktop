import type { ValueOf } from "@/renderer/shared/types/common";

/** 사용자가 고르는 테마. `system`은 OS 설정(`prefers-color-scheme`)을 따른다. */
export const THEME_MODE = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark"
} as const;

export type ThemeMode = ValueOf<typeof THEME_MODE>;

/** 다크 토큰을 켜는 `<html>` 클래스(`app/styles/tokens.css`의 `.dark`) */
export const DARK_THEME_CLASS = "dark";

/** OS가 다크 모드인지 묻는 미디어 쿼리 */
export const DARK_COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * 펼쳐진 파일 그룹을 구분하는 테두리 색 클래스(`app/styles/tokens.css`의 `--group-1`~`5`).
 * 여러 파일이 펼쳐져 있을 때 각 파일 그룹을 시각적으로 구분한다.
 */
export const GROUP_COLOR_CLASSES = [
  "border-group-1",
  "border-group-2",
  "border-group-3",
  "border-group-4",
  "border-group-5"
] as const;

export type GroupColorClass = (typeof GROUP_COLOR_CLASSES)[number];

interface GetGroupColorClassParams {
  /** 파일 인덱스. 그룹 색 수를 넘으면 처음부터 다시 돈다. */
  index: number;
}

/** 파일 인덱스에 해당하는 그룹 테두리 색 클래스 */
export function getGroupColorClass({
  index
}: GetGroupColorClassParams): GroupColorClass {
  return GROUP_COLOR_CLASSES[index % GROUP_COLOR_CLASSES.length];
}
