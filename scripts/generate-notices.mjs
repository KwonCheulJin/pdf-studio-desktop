#!/usr/bin/env node

// Rust·npm 의존성과 번들 바이너리·자산의 라이선스를 모아 THIRD_PARTY_NOTICES.md 를 만든다.
// pdfium 라이선스 원문을 읽으므로 먼저 pdfium을 받아 둔다(scripts/third-party/bundled.mjs).
// 사용: pnpm licenses:generate

import console from "node:console";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectComponents } from "./third-party/collect.mjs";
import { NOTICES_FILE_NAME, renderNotices } from "./third-party/render.mjs";
import { ROOT } from "./third-party/text.mjs";

const components = collectComponents();
writeFileSync(join(ROOT, NOTICES_FILE_NAME), renderNotices(components));
console.log(
  `${NOTICES_FILE_NAME} 생성: 번들 ${components.bundled.length}개, Rust ${components.cargo.length}개, npm ${components.npm.length}개`
);
