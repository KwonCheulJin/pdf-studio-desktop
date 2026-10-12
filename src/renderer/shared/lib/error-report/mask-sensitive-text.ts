/**
 * 오류 보고를 보내기 전에 파일 경로·파일 이름을 지운다(계획서 P1-5 S2).
 * - 확장자가 있는 경로(파일): 확장자만 남긴다. `/Users/x/문서/계약.pdf` → `*.pdf`
 * - 확장자가 없는 경로(폴더): 홈 아래면 `~/…`, 아니면 `…`
 * - 경로 없이 쓰인 문서 파일 이름(`계약.pdf`): `*.pdf`
 * POSIX(`/…`, `~/…`), Windows(`C:\…`, `\\서버\…`), `file://` 경로를 찾는다.
 * `scheme://host/…` URL(스택의 앱 자산 위치)은 경로로 보지 않고 그대로 둔다.
 * 경로에 공백이 있어도 확장자까지 한 경로로 본다. 확장자가 없는 경로는 줄 끝이나
 * 따옴표·괄호까지 모두 지운다(덜 지우기보다 더 지우는 쪽).
 */

/** 경로 문자 다음에 올 수 없는 문자(줄바꿈, 따옴표, 괄호, 꺾쇠, 파이프) */
const PATH_CHARACTER = String.raw`[^\n\r"'\x60()<>|]`;

/** 단어·URL·다른 경로 안이 아닌 자리에서만 경로가 시작한다. */
const PATH_START = String.raw`(?<![\w.~/\\-])`;

/** 홈(`~`), 드라이브(`C:`), UNC(`\\`), POSIX 루트(`/`). 바로 뒤에 이름이 와야 한다. */
const PATH_ROOT = String.raw`(?:file:\/\/)?(?:~[\\/]|[A-Za-z]:[\\/]|\\\\|\/)(?![\\/\s])`;

/** 확장자: 글자로 시작하는 1~10자 */
const EXTENSION = "([A-Za-z][A-Za-z0-9]{0,9})";

/** 확장자 뒤에 올 수 있는 것: 끝, 공백, 구분 기호, 닫는 따옴표·괄호, 문장 끝 마침표 */
const EXTENSION_END = String.raw`(?=\.?(?:[\s:;,"'\x60)>\]]|$))`;

const PATH_PATTERN = new RegExp(
  `${PATH_START}${PATH_ROOT}(?:${PATH_CHARACTER}*?\\.${EXTENSION}${EXTENSION_END}|${PATH_CHARACTER}*)`,
  "gu"
);

/** 경로 없이 쓰인 문서 파일 이름. 이 앱이 여는 형식만 본다. */
const DOCUMENT_NAME_PATTERN = new RegExp(
  String.raw`(?<=^|[\s"'\x60(\[{<=,:])[^\s/\\"'\x60*:<>|]+\.(pdf|tiff?)${EXTENSION_END}`,
  "giu"
);

/** 사용자 홈 폴더로 시작하는 경로(`~`, macOS `/Users/이름`, Linux `/home/이름`, Windows `C:\Users\이름`) */
const HOME_PATH_PATTERN =
  /^(?:file:\/\/)?(?:~|\/Users\/|\/home\/|\/root\b|[A-Za-z]:[\\/]Users[\\/])/iu;

const MASKED_FILE_PREFIX = "*.";
const MASKED_HOME_PATH = "~/…";
const MASKED_PATH = "…";

function maskPath(path: string, extension: string | undefined): string {
  if (extension !== undefined) {
    return `${MASKED_FILE_PREFIX}${extension}`;
  }
  return HOME_PATH_PATTERN.test(path) ? MASKED_HOME_PATH : MASKED_PATH;
}

/** 글 안의 파일 경로·파일 이름을 지운다. */
export function maskSensitiveText(text: string): string {
  return text
    .replace(PATH_PATTERN, (path: string, extension: string | undefined) =>
      maskPath(path, extension)
    )
    .replace(
      DOCUMENT_NAME_PATTERN,
      (_name: string, extension: string) => `${MASKED_FILE_PREFIX}${extension}`
    );
}

/** 추가 필드(meta) 안의 모든 문자열을 지운다. 배열·객체는 안쪽까지 본다. */
export function maskReportValue(value: unknown): unknown {
  if (typeof value === "string") {
    return maskSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map(maskReportValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, maskReportValue(entry)])
    );
  }
  return value;
}

/** 메시지와 스택을 지운 새 오류. 이름(`name`)은 그대로 둔다. */
export function maskError(error: Error): Error {
  const masked = new Error(maskSensitiveText(error.message));
  masked.name = error.name;
  masked.stack = maskSensitiveText(error.stack ?? "");
  return masked;
}
