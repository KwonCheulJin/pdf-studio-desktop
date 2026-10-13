#!/usr/bin/env node
// 버전 범프 → 릴리스 커밋 → annotated 태그 `v<버전>`까지만 한다. 푸시는 사용자가 한다.
// 태그 푸시를 받은 .github/workflows/release.yml이 Draft Release를 만든다(계획서 P4-2).
// 사용: pnpm release:patch | release:minor | release:major

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUMP_LEVELS = ["patch", "minor", "major"];
const RELEASE_BRANCH = "main";
const PACKAGE_JSON_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../package.json"
);

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf-8" }).trim();
}

function fail(message) {
  console.error(`릴리스 중단: ${message}`);
  process.exit(1);
}

const level = process.argv[2];
if (!BUMP_LEVELS.includes(level)) {
  fail(
    `범프 단계는 ${BUMP_LEVELS.join("|")} 중 하나여야 한다(받은 값: ${level})`
  );
}

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== RELEASE_BRANCH) {
  fail(`${RELEASE_BRANCH} 브랜치에서만 릴리스한다(지금: ${branch})`);
}
if (run("git", ["status", "--porcelain"]) !== "") {
  fail("작업 트리에 커밋하지 않은 변경이 있다");
}

// tauri.conf.json의 version은 package.json을 가리킨다(단일 소스).
execFileSync("pnpm", ["version", level, "--no-git-tag-version"], {
  stdio: "inherit"
});
const { version } = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"));
const tag = `v${version}`;

if (run("git", ["tag", "--list", tag]) !== "") {
  execFileSync("git", ["checkout", "--", "package.json"]);
  fail(`태그 ${tag}가 이미 있다`);
}

execFileSync("git", ["add", "package.json"], { stdio: "inherit" });
execFileSync("git", ["commit", "-m", `chore: release ${tag}`], {
  stdio: "inherit"
});
// --follow-tags는 annotated 태그만 올리므로 -a로 만든다.
execFileSync("git", ["tag", "-a", tag, "-m", tag], { stdio: "inherit" });

console.log(`\n${tag} 커밋과 태그를 만들었다. 확인한 뒤 직접 푸시한다:`);
console.log(`  git push origin ${RELEASE_BRANCH} --follow-tags`);
console.log("태그 푸시를 받은 release 워크플로가 Draft Release를 만든다.");
