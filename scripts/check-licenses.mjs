#!/usr/bin/env node

// 라이선스 검사. 다음 중 하나라도 있으면 0이 아닌 코드로 끝난다.
// 1. 계획서 §1.2 허용 목록과 이름 고정 예외(scripts/third-party/policy.mjs) 밖 라이선스
// 2. 커밋한 THIRD_PARTY_NOTICES.md 가 지금 의존성으로 다시 만든 것과 다름(pnpm licenses:generate 를 잊음)
// 사용: pnpm licenses:check (pdfium을 먼저 받아 둔다. scripts/third-party/bundled.mjs 참고)

import console from "node:console";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { collectComponents } from "./third-party/collect.mjs";
import { isLicenseAllowed, unusedExceptions } from "./third-party/policy.mjs";
import { NOTICES_FILE_NAME, renderNotices } from "./third-party/render.mjs";
import { normalizeText, ROOT } from "./third-party/text.mjs";

const components = collectComponents();
const all = [...components.bundled, ...components.cargo, ...components.npm];

const rejected = all.filter((component) => !isLicenseAllowed(component));
for (const component of rejected) {
  console.error(
    `허용 목록 밖: [${component.ecosystem}] ${component.name} ${component.version} — ${component.license || "(라이선스 없음)"}`
  );
}

for (const entry of unusedExceptions(all)) {
  console.warn(`쓰이지 않는 예외(정리 대상): ${entry}`);
}

const noticesPath = join(ROOT, NOTICES_FILE_NAME);
const isNoticesCurrent =
  existsSync(noticesPath) &&
  normalizeText(readFileSync(noticesPath, "utf8")) ===
    normalizeText(renderNotices(components));
if (!isNoticesCurrent) {
  console.error(
    `${NOTICES_FILE_NAME}가 지금 의존성과 다르다. pnpm licenses:generate 로 다시 만든다.`
  );
}

if (rejected.length > 0 || !isNoticesCurrent) {
  process.exit(1);
}
console.log(`라이선스 검사 통과: ${all.length}개`);
