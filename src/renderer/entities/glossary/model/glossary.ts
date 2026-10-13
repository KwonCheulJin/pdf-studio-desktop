import type { GlossaryTerm } from "@/renderer/shared/api/bindings";

/** 용어 표의 한 행. `id`는 화면 행을 구분하는 값이라 저장하지 않는다. */
export interface GlossaryRow extends GlossaryTerm {
  id: string;
}

/** Rust와 같은 정규화(ADR 0002 §10): 앞뒤 공백을 지우고 NFC */
const NORMALIZATION_FORM = "NFC";

function normalizeText(text: string): string {
  return text.trim().normalize(NORMALIZATION_FORM);
}

export function createGlossaryRow(): GlossaryRow {
  return { id: crypto.randomUUID(), source: "", target: "" };
}

export function toGlossaryRows(terms: readonly GlossaryTerm[]): GlossaryRow[] {
  return terms.map((term) => ({ ...term, id: crypto.randomUUID() }));
}

/** 표에 적힌 그대로(빈 칸 포함)의 용어. 저장할 때 쓴다. */
export function toGlossaryTerms(rows: readonly GlossaryRow[]): GlossaryTerm[] {
  return rows.map(({ source, target }) => ({ source, target }));
}

function isGlossaryTerm(value: unknown): value is GlossaryTerm {
  return (
    typeof value === "object" &&
    value !== null &&
    "source" in value &&
    "target" in value &&
    typeof value.source === "string" &&
    typeof value.target === "string"
  );
}

/** 설정 저장소에서 읽은 값이 용어 목록 모양인지. 손상됐을 수 있어 하나하나 본다. */
export function isGlossaryTerms(value: unknown): value is GlossaryTerm[] {
  return Array.isArray(value) && value.every(isGlossaryTerm);
}

/**
 * 번역에 실을 용어(ADR 0002 §10): 원어·번역어를 정규화하고, 어느 쪽이든 비면 빼고,
 * 같은 원어가 둘이면 앞의 것을 쓴다.
 */
export function normalizeGlossary(
  terms: readonly GlossaryTerm[]
): GlossaryTerm[] {
  const seenSources = new Set<string>();
  return terms.reduce<GlossaryTerm[]>((normalized, term) => {
    const source = normalizeText(term.source);
    const target = normalizeText(term.target);
    if (source === "" || target === "" || seenSources.has(source)) {
      return normalized;
    }
    seenSources.add(source);
    return [...normalized, { source, target }];
  }, []);
}

/**
 * 번역에 실리지 않는 행: 빈 칸이 있거나 앞에 같은 원어가 있다. 둘 다 빈 행(막 추가한 행)은
 * 아직 쓰는 중이라 넣지 않는다.
 */
export function findIgnoredRowIds(rows: readonly GlossaryRow[]): Set<string> {
  const seenSources = new Set<string>();
  const ignored = new Set<string>();
  for (const row of rows) {
    const source = normalizeText(row.source);
    const target = normalizeText(row.target);
    if (source === "" && target === "") continue;
    if (source === "" || target === "" || seenSources.has(source)) {
      ignored.add(row.id);
      continue;
    }
    seenSources.add(source);
  }
  return ignored;
}
