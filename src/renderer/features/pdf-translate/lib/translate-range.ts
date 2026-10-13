import {
  parsePageRange,
  type PageRangeError
} from "@/renderer/shared/lib/page-range-parse";
import type { TranslateFile } from "../model/translate-session-store";

interface TranslateRangeErrorParams {
  file: TranslateFile | null;
  range: string;
}

/** 쪽 범위 검사(Rust와 같은 규칙, ADR 0001 §13). 문서가 없으면 쪽 수를 몰라 검사하지 않는다. */
export function translateRangeErrorOf({
  file,
  range
}: TranslateRangeErrorParams): PageRangeError | null {
  if (!file) return null;
  const parsed = parsePageRange({ input: range, pageCount: file.pageCount });
  return parsed.isValid ? null : parsed.error;
}
