#!/usr/bin/env node
// macOS .app 서명 검사(계획서 P4-3). release 워크플로와 로컬에서 같은 기준으로 돈다.
// 1) codesign --verify --deep --strict  2) 앱에 hardened runtime  3) disable-library-validation entitlement
// 4) Contents/Frameworks의 필수 dylib가 앱과 같은 identity(서명 주체 + Team ID)로 서명됐는가
// 사용: node scripts/verify-macos-signature.mjs ["<.app 경로>"]  (기본: release 빌드 위치)

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const DEFAULT_APP_PATH = "target/release/bundle/macos/PDF Studio.app";
const REQUIRED_FRAMEWORKS = ["libpdfium.dylib", "libonnxruntime.dylib"];
const RUNTIME_FLAG = "runtime";
const LIBRARY_VALIDATION_ENTITLEMENT =
  "com.apple.security.cs.disable-library-validation";

// codesign은 정보를 stderr로 낸다. 두 출력을 합쳐 그대로 기록에 남긴다.
function codesign(args) {
  const result = spawnSync("codesign", args, { encoding: "utf-8" });
  const output = `${result.stdout}${result.stderr}`.trim();
  console.log(`$ codesign ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
  console.log(output);
  console.log("");
  return { ok: result.status === 0, output };
}

function field(output, name) {
  const line = output.split("\n").find((entry) => entry.startsWith(`${name}=`));
  return line === undefined ? undefined : line.slice(name.length + 1);
}

// ad-hoc은 `Signature=adhoc`, 인증서 서명은 첫 `Authority=`가 서명 주체다.
function signingIdentity(output) {
  const signer = field(output, "Signature") ?? field(output, "Authority");
  return `${signer ?? "unsigned"} / Team ${field(output, "TeamIdentifier") ?? "none"}`;
}

const appPath = resolve(process.argv[2] ?? DEFAULT_APP_PATH);
const failures = [];

if (!codesign(["--verify", "--deep", "--strict", "--verbose=2", appPath]).ok) {
  failures.push("codesign --verify --deep --strict 실패");
}

const app = codesign(["-dv", "--verbose=2", appPath]);
const appIdentity = signingIdentity(app.output);
if (!(field(app.output, "CodeDirectory v") ?? "").includes(RUNTIME_FLAG)) {
  failures.push("앱에 hardened runtime(flags의 runtime)이 없다");
}

const entitlements = codesign(["-d", "--entitlements", "-", "--xml", appPath]);
if (!entitlements.output.includes(LIBRARY_VALIDATION_ENTITLEMENT)) {
  failures.push(`앱 entitlement에 ${LIBRARY_VALIDATION_ENTITLEMENT}가 없다`);
}

for (const name of REQUIRED_FRAMEWORKS) {
  const framework = codesign([
    "-dv",
    "--verbose=2",
    join(appPath, "Contents", "Frameworks", name)
  ]);
  const identity = signingIdentity(framework.output);
  if (!framework.ok) {
    failures.push(`${name} 서명 정보를 읽지 못했다`);
  } else if (identity !== appIdentity) {
    failures.push(
      `${name} identity(${identity})가 앱(${appIdentity})과 다르다`
    );
  }
}

console.log(`앱 identity: ${appIdentity}`);
if (failures.length > 0) {
  console.error(`서명 검사 실패:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `서명 검사 통과: ${REQUIRED_FRAMEWORKS.join(", ")}가 앱과 같은 identity로 서명됐다`
);
