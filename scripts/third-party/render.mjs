// THIRD_PARTY_NOTICES.md 본문을 만든다. 같은 원문(공백 차이 무시)은 한 번만 싣고
// 어느 구성요소에 적용되는지 적는다. 날짜·절대 경로를 넣지 않아 같은 입력이면 같은 결과다.

import { createHash } from "node:crypto";

export const NOTICES_FILE_NAME = "THIRD_PARTY_NOTICES.md";

const FENCE_CHARACTER = "~";
const MINIMUM_FENCE_LENGTH = 3;
const NO_TEXT = "—";

function textKey(content) {
  return createHash("sha256")
    .update(content.replace(/\s+/g, " ").trim())
    .digest("hex");
}

function cell(value) {
  return String(value ?? NO_TEXT)
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function fenceFor(content) {
  const longest = Math.max(
    0,
    ...(content.match(new RegExp(`${FENCE_CHARACTER}+`, "g")) ?? []).map(
      (run) => run.length
    )
  );
  return FENCE_CHARACTER.repeat(Math.max(MINIMUM_FENCE_LENGTH, longest + 1));
}

/** 원문을 모아 번호를 매긴다. 구성요소마다 자기 원문 번호 목록을 갖는다. */
function numberTexts(components) {
  const texts = new Map();
  const numbersOf = new Map();
  for (const component of components) {
    const numbers = [];
    for (const text of component.texts) {
      const key = textKey(text.content);
      if (!texts.has(key)) {
        texts.set(key, {
          number: texts.size + 1,
          content: text.content,
          usedBy: []
        });
      }
      const entry = texts.get(key);
      entry.usedBy.push(
        `${component.name} ${component.version} (${text.name})`
      );
      if (!numbers.includes(entry.number)) numbers.push(entry.number);
    }
    numbersOf.set(component, numbers);
  }
  return { texts: [...texts.values()], numbersOf };
}

function numberList(numbers) {
  return numbers.length > 0 ? numbers.join(", ") : NO_TEXT;
}

function dependencyTable(components, numbersOf) {
  return [
    "| 이름 | 버전 | 라이선스 | 출처 | 원문 |",
    "|---|---|---|---|---|",
    ...components.map(
      (component) =>
        `| ${cell(component.name)} | ${cell(component.version)} | ${cell(component.license)} | ${cell(component.source)} | ${numberList(numbersOf.get(component))} |`
    )
  ];
}

export function renderNotices({ bundled, cargo, npm }) {
  const { texts, numbersOf } = numberTexts([...bundled, ...cargo, ...npm]);
  const lines = [
    "# 제3자 고지 (Third-Party Notices)",
    "",
    "PDF Studio는 MIT 라이선스로 배포한다(`LICENSE`). 앱에는 아래 제3자 소프트웨어가 함께 들어간다.",
    "각 구성요소의 라이선스 원문은 「4. 라이선스 원문」에 번호로 싣는다.",
    "원문 칸이 `—`인 패키지는 패키지에 원문 파일이 없어 SPDX 표준 원문(https://spdx.org/licenses/)을 따른다.",
    "",
    "이 파일은 `pnpm licenses:generate`가 만든다. 손으로 고치지 않는다.",
    "",
    `- 번들 바이너리·자산: ${bundled.length}개`,
    `- Rust 크레이트: ${cargo.length}개`,
    `- npm 패키지: ${npm.length}개`,
    "",
    "## 1. 번들 바이너리·자산",
    ""
  ];
  for (const component of bundled) {
    lines.push(
      `### ${component.name} ${component.version}`,
      "",
      `- 라이선스: ${component.license}`,
      `- 출처: ${component.source}`,
      ...(component.note ? [`- ${component.note}`] : []),
      `- 원문: ${numberList(numbersOf.get(component))}`,
      ""
    );
  }
  lines.push(
    "## 2. Rust 크레이트",
    "",
    ...dependencyTable(cargo, numbersOf),
    "",
    "## 3. npm 패키지",
    "",
    ...dependencyTable(npm, numbersOf),
    "",
    "## 4. 라이선스 원문",
    ""
  );
  for (const text of texts) {
    const fence = fenceFor(text.content);
    lines.push(
      `### 원문 ${text.number}`,
      "",
      `적용: ${text.usedBy.join(", ")}`,
      "",
      `${fence}text`,
      text.content,
      fence,
      ""
    );
  }
  return lines.join("\n");
}
