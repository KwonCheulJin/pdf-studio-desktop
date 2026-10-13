import {
  EXPORT_FILE_KIND,
  EXPORT_FILE_SUFFIX,
  FILE_NAME_JOINER,
  FILE_NAME_SEPARATORS,
  PDF_FILE_EXTENSION,
  type ExportFileKind
} from "../config/export-report";

interface ExportFileNamesParams {
  /** A(이전) 문서의 화면 이름(확장자 포함) */
  beforeName: string;
  /** B(이후) 문서의 화면 이름(확장자 포함) */
  afterName: string;
}

/** 이름 끝의 `.pdf`(대소문자 무시)를 뺀다. */
function withoutPdfExtension(name: string): string {
  return name.toLowerCase().endsWith(PDF_FILE_EXTENSION)
    ? name.slice(0, name.length - PDF_FILE_EXTENSION.length)
    : name;
}

/**
 * 두 문서 이름에서 공통 머리를 한 번만 쓴 이름(시안 5: `공급계약서_v1` + `공급계약서_v2` →
 * `공급계약서_v1-v2`). 머리는 두 이름의 같은 앞부분 중 마지막 구분자(`_` `-` 공백 `.`)까지이고, 없으면 두
 * 이름을 그대로 잇는다. 같은 이름이면 하나만 쓴다. 구분자가 ASCII라 머리 끝이 한 글자를 가르지 않는다.
 */
function joinedStem({ beforeName, afterName }: ExportFileNamesParams): string {
  const before = withoutPdfExtension(beforeName);
  const after = withoutPdfExtension(afterName);
  if (before === after) return before;
  const limit = Math.min(before.length, after.length);
  const firstDifference = Array.from(
    { length: limit },
    (_, index) => index
  ).find((index) => before[index] !== after[index]);
  const shared = before.slice(0, firstDifference ?? limit);
  const headLength =
    Math.max(
      ...FILE_NAME_SEPARATORS.map((separator) => shared.lastIndexOf(separator))
    ) + 1;
  return `${before}${FILE_NAME_JOINER}${after.slice(headLength)}`;
}

/** 받을 파일마다 만들 이름. 같은 이름이 폴더에 있으면 Rust가 번호를 붙여 새 이름으로 만든다. */
export function exportFileNames(
  params: ExportFileNamesParams
): Record<ExportFileKind, string> {
  const stem = joinedStem(params);
  const nameOf = (kind: ExportFileKind) =>
    `${stem}${EXPORT_FILE_SUFFIX[kind]}${PDF_FILE_EXTENSION}`;
  return {
    [EXPORT_FILE_KIND.COMPARE]: nameOf(EXPORT_FILE_KIND.COMPARE),
    [EXPORT_FILE_KIND.ANNOTATED]: nameOf(EXPORT_FILE_KIND.ANNOTATED)
  };
}
