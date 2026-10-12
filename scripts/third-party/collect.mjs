// Rust·npm 의존성과 번들 자산을 모은다. 새 도구 없이 cargo·pnpm 기본 명령만 쓴다.
// - Rust: `cargo metadata`. 워크스페이스 멤버(이 앱)에서 normal 의존성만 따라간다.
//   dev 의존성(테스트 전용)과 build 의존성(빌드 때만 실행)은 앱에 들어가지 않아 뺀다.
//   타깃을 거르지 않으므로 Windows·Linux 전용 크레이트도 들어간다(고지 하나를 모든 OS가 함께 쓴다).
// - npm: `pnpm licenses list --json --prod`(devDependencies 제외).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { bundledComponents } from "./bundled.mjs";
import { ECOSYSTEM, isFirstParty } from "./policy.mjs";
import { readText, ROOT } from "./text.mjs";

const OUTPUT_BUFFER_BYTES = 512 * 1024 * 1024;

// 패키지 폴더 맨 위에서 라이선스 원문으로 읽는 파일·폴더 이름
const LICENSE_FILE_PATTERN =
  /^(licen[cs]e|copying|notice|copyright|unlicense)([-._].*)?$/i;
const LICENSE_DIRECTORY_PATTERN = /^licen[cs]es$/i;

function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: OUTPUT_BUFFER_BYTES,
    // Windows에서 pnpm은 .cmd 라 셸을 거쳐야 실행된다. 인자는 고정값뿐이다.
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"]
  });
}

// 로캘과 상관없이 같은 순서가 나오도록 코드 포인트로 비교한다.
const byCodePoint = (left, right) => (left < right ? -1 : Number(left > right));
const byFileName = byCodePoint;

function licenseFilesIn(directory) {
  return readdirSync(directory)
    .sort(byFileName)
    .flatMap((entry) => {
      const path = join(directory, entry);
      const isDirectory = statSync(path).isDirectory();
      if (isDirectory && LICENSE_DIRECTORY_PATTERN.test(entry)) {
        return readdirSync(path)
          .sort(byFileName)
          .map((child) => ({
            name: `${entry}/${child}`,
            path: join(path, child)
          }))
          .filter(({ path: childPath }) => statSync(childPath).isFile());
      }
      return !isDirectory && LICENSE_FILE_PATTERN.test(entry)
        ? [{ name: entry, path }]
        : [];
    });
}

/** 패키지 폴더의 LICENSE·NOTICE 등 원문. `extraFile`은 cargo `license-file` 필드 */
function licenseTexts(directory, extraFile) {
  const files = licenseFilesIn(directory);
  if (extraFile && !files.some(({ name }) => name === extraFile)) {
    files.push({ name: extraFile, path: join(directory, extraFile) });
  }
  return files.map(({ name, path }) => ({ name, content: readText(path) }));
}

function collectCargo() {
  const metadata = JSON.parse(
    run("cargo", ["metadata", "--format-version", "1", "--locked"])
  );
  const packages = new Map(metadata.packages.map((item) => [item.id, item]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const members = new Set(metadata.workspace_members);
  const reached = new Set();
  const pending = [...members];
  while (pending.length > 0) {
    const id = pending.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    for (const dependency of nodes.get(id).deps) {
      // kind null = normal 의존성
      if (dependency.dep_kinds.some((kind) => kind.kind === null)) {
        pending.push(dependency.pkg);
      }
    }
  }
  return [...reached]
    .filter((id) => !members.has(id))
    .map((id) => packages.get(id))
    .map((item) => {
      const directory = join(item.manifest_path, "..");
      return {
        ecosystem: ECOSYSTEM.CARGO,
        name: item.name,
        version: item.version,
        license: item.license ?? "",
        source: item.repository ?? item.homepage ?? null,
        texts: licenseTexts(directory, item.license_file)
      };
    });
}

const NODE_MODULES = "node_modules";
const SCOPE_PREFIX = "@";
const HIDDEN_PREFIX = ".";

/**
 * 설치된 패키지 폴더 색인(`이름@버전` → 폴더). `node-linker=hoisted`에서는
 * `pnpm licenses list`가 실제로 없는 가상 저장소 경로를 돌려주므로 그때 쓴다.
 */
function indexInstalledPackages() {
  const index = new Map();
  const visit = (modulesDirectory) => {
    if (!existsSync(modulesDirectory)) return;
    for (const entry of readdirSync(modulesDirectory).sort(byFileName)) {
      if (entry.startsWith(HIDDEN_PREFIX)) continue;
      const path = join(modulesDirectory, entry);
      const packageDirectories = entry.startsWith(SCOPE_PREFIX)
        ? readdirSync(path)
            .sort(byFileName)
            .map((child) => join(path, child))
        : [path];
      for (const directory of packageDirectories) {
        const manifestPath = join(directory, "package.json");
        if (!existsSync(manifestPath)) continue;
        const { name, version } = JSON.parse(
          readFileSync(manifestPath, "utf8")
        );
        const key = `${name}@${version}`;
        if (!index.has(key)) index.set(key, directory);
        visit(join(directory, NODE_MODULES));
      }
    }
  };
  visit(join(ROOT, NODE_MODULES));
  return index;
}

function collectNpm() {
  let installed = null;
  const directoryOf = (name, version, reportedPath) => {
    if (existsSync(reportedPath)) return reportedPath;
    installed ??= indexInstalledPackages();
    const directory = installed.get(`${name}@${version}`);
    if (!directory)
      throw new Error(`설치된 패키지를 찾지 못했다: ${name}@${version}`);
    return directory;
  };
  const groups = JSON.parse(
    run("pnpm", ["licenses", "list", "--json", "--prod"])
  );
  return Object.entries(groups).flatMap(([license, items]) =>
    items.flatMap((item) =>
      item.versions.map((version, index) => ({
        ecosystem: ECOSYSTEM.NPM,
        name: item.name,
        version,
        license,
        source: item.homepage ?? null,
        directory: directoryOf(item.name, version, item.paths[index])
      }))
    )
  );
}

const byIdentity = (left, right) =>
  byCodePoint(left.name, right.name) ||
  left.version.localeCompare(right.version, "en", { numeric: true });

/**
 * `os`·`cpu`를 정한 패키지는 설치한 OS에만 깔리는 네이티브 바이너리다(pdf.js의 Node용
 * `@napi-rs/canvas-<플랫폼>` 등). 웹뷰 번들에 들어가지 않고, 넣으면 고지가 OS마다 달라진다.
 */
function isPlatformBinary({ directory }) {
  const manifest = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8")
  );
  return manifest.os !== undefined || manifest.cpu !== undefined;
}

/** 고지·검사 대상 전체. 이 앱 저작자의 패키지는 뺀다. 같은 생태계 안에서 이름·버전 순 */
export function collectComponents() {
  const npm = collectNpm()
    .filter(
      (component) => !isFirstParty(component) && !isPlatformBinary(component)
    )
    .map(({ directory, ...component }) => ({
      ...component,
      texts: licenseTexts(directory)
    }));
  return {
    bundled: bundledComponents(),
    cargo: collectCargo().sort(byIdentity),
    npm: npm.sort(byIdentity)
  };
}
