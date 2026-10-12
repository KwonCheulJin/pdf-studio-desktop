import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 라이선스 원문을 OS와 상관없이 같은 모양으로 맞춘다: 줄 끝 LF, 줄 끝 공백 제거,
 * 앞뒤 빈 줄 제거. 어느 OS에서 만들어도 같은 고지가 나오게 하기 위해서다.
 */
export function normalizeText(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

export function readText(path) {
  return normalizeText(readFileSync(path, "utf8"));
}
