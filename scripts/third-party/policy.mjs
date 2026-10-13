// 라이선스 허용 목록과 예외(계획서 §1.2). 검사(check-licenses.mjs)가 쓴다.
// 예외는 라이선스마다 이름을 고정한다. 같은 라이선스의 새 패키지가 들어오면 검사가 실패해
// 사람이 근거를 보고 이 목록과 계획서를 함께 고치게 한다.

export const ECOSYSTEM = {
  CARGO: "cargo",
  NPM: "npm",
  BUNDLED: "bundled"
};

/** §1.2 허용 목록(MIT, BSD, Apache-2.0, ISC, Zlib)의 SPDX 식별자 */
export const ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib"
]);

/** 이름을 고정해 허용하는 예외. `reason`은 계획서 §1.2의 근거다. */
export const LICENSE_EXCEPTIONS = [
  {
    license: "Unicode-3.0",
    reason:
      "§1.2 예외: 유니코드 데이터, Tauri 하위 의존성(url·urlpattern의 ICU4X, proc-macro2)",
    ecosystem: ECOSYSTEM.CARGO,
    names: [
      "icu_collections",
      "icu_locale_core",
      "icu_normalizer",
      "icu_normalizer_data",
      "icu_properties",
      "icu_properties_data",
      "icu_provider",
      "litemap",
      "potential_utf",
      "tinystr",
      "unicode-ident",
      "writeable",
      "yoke",
      "yoke-derive",
      "zerofrom",
      "zerofrom-derive",
      "zerotrie",
      "zerovec",
      "zerovec-derive"
    ]
  },
  {
    license: "MPL-2.0",
    reason:
      "§1.2 예외: Tauri 하위 의존성(tauri-utils의 dom_query, dirs), 수정 없이 링크만",
    ecosystem: ECOSYSTEM.CARGO,
    names: [
      "cssparser",
      "cssparser-macros",
      "dtoa-short",
      "option-ext",
      "selectors"
    ]
  },
  {
    license: "0BSD",
    reason: "§1.2 예외: 저작권 표시 의무도 없는 BSD 계열(firebase 하위 의존성)",
    ecosystem: ECOSYSTEM.NPM,
    names: ["tslib"]
  },
  {
    license: "OFL-1.1",
    reason: "§1.2 허용: OFL(글꼴)",
    ecosystem: ECOSYSTEM.NPM,
    names: ["@fontsource/ibm-plex-sans-kr", "@fontsource/ibm-plex-mono"]
  },
  {
    license: "OFL-1.1",
    reason: "§1.2 허용: OFL(글꼴)",
    ecosystem: ECOSYSTEM.BUNDLED,
    names: [
      "IBM Plex Sans KR · IBM Plex Mono",
      "pdf.js 표준 글꼴: Liberation Sans"
    ]
  },
  {
    license: "CC0-1.0",
    reason:
      "§1.2 예외: 권리 포기(퍼블릭 도메인) ICC 프로필, pdfjs-dist 배포본에 포함",
    ecosystem: ECOSYSTEM.BUNDLED,
    names: ["pdf.js ICC 프로필"]
  }
];

/**
 * 고지·검사에서 빼는 패키지. 이 앱의 저작자(KwonCheulJin)가 직접 만든 패키지라
 * 제3자 소프트웨어가 아니다(2026-10-13 사용자 결정).
 */
export const FIRST_PARTY_PACKAGES = [
  { ecosystem: ECOSYSTEM.NPM, name: "@kwoncheulJin/error-snapshot" }
];

export function isFirstParty({ ecosystem, name }) {
  return FIRST_PARTY_PACKAGES.some(
    (entry) => entry.ecosystem === ecosystem && entry.name === name
  );
}

const TOKEN = {
  OPEN: "(",
  CLOSE: ")",
  AND: "AND",
  OR: "OR",
  WITH: "WITH"
};

// SPDX 식 토큰. 옛 표기 `MIT/Apache-2.0`의 `/`는 OR이다.
function tokenize(expression) {
  return expression
    .replaceAll(TOKEN.OPEN, ` ${TOKEN.OPEN} `)
    .replaceAll(TOKEN.CLOSE, ` ${TOKEN.CLOSE} `)
    .replaceAll("/", ` ${TOKEN.OR} `)
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * SPDX 식을 평가한다. OR는 하나만, AND는 모두 허용돼야 한다.
 * `X WITH <예외 조항>`은 조항이 권리를 넓히기만 하므로 X로 본다.
 */
function evaluate(expression, isAllowed) {
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];

  const parseAtom = () => {
    const token = next();
    if (token === undefined) throw new Error(`식이 끝났다: ${expression}`);
    if (token === TOKEN.OPEN) {
      const value = parseOr();
      if (next() !== TOKEN.CLOSE)
        throw new Error(`괄호가 닫히지 않았다: ${expression}`);
      return value;
    }
    if (peek() === TOKEN.WITH) {
      next();
      next();
    }
    return isAllowed(token);
  };
  const parseAnd = () => {
    let value = parseAtom();
    while (peek() === TOKEN.AND) {
      next();
      value = parseAtom() && value;
    }
    return value;
  };
  function parseOr() {
    let value = parseAnd();
    while (peek() === TOKEN.OR) {
      next();
      value = parseAnd() || value;
    }
    return value;
  }

  const value = parseOr();
  if (position !== tokens.length)
    throw new Error(`해석하지 못한 식: ${expression}`);
  return value;
}

/** 구성요소 하나가 허용 목록·예외로 허용되는지. 라이선스가 비었거나 식이 깨졌으면 거부 */
export function isLicenseAllowed({ ecosystem, name, license }) {
  if (!license) return false;
  const isAllowed = (identifier) =>
    ALLOWED_LICENSES.has(identifier) ||
    LICENSE_EXCEPTIONS.some(
      (exception) =>
        exception.license === identifier &&
        exception.ecosystem === ecosystem &&
        exception.names.includes(name)
    );
  try {
    return evaluate(license, isAllowed);
  } catch {
    return false;
  }
}

/** 지금 의존성에 없는 예외 이름(목록을 정리할 때 본다) */
export function unusedExceptions(components) {
  return LICENSE_EXCEPTIONS.flatMap((exception) =>
    exception.names
      .filter(
        (name) =>
          !components.some(
            (component) =>
              component.ecosystem === exception.ecosystem &&
              component.name === name
          )
      )
      .map((name) => `${exception.ecosystem} ${name} (${exception.license})`)
  );
}
