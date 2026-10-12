#!/usr/bin/env node

// bblanchon/pdfium-binaries의 고정 릴리스를 받아 SHA-256을 검증하고
// src-tauri/pdfium/<target-triple>/ 에 라이브러리와 라이선스를 둔다.
// 사용: node scripts/fetch-pdfium.mjs [--target <target-triple>]

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

// pdfium-render의 `pdfium_7881` 기능과 같은 API 버전이다. 함께 올린다.
const PDFIUM_RELEASE_TAG = "chromium/7881";
const RELEASE_BASE_URL =
  "https://github.com/bblanchon/pdfium-binaries/releases/download/" +
  encodeURIComponent(PDFIUM_RELEASE_TAG);

// archiveSha256: GitHub 릴리스 자산의 digest 값(내려받아 같은 값임을 확인함)
// librarySha256: 그 아카이브 안 라이브러리 파일의 SHA-256
const TARGETS = {
  "aarch64-apple-darwin": {
    archive: "pdfium-mac-arm64.tgz",
    archiveSha256:
      "52e94ca5aa8847934330daf3f8150c190682c5ca93831468794f8b90d4392e40",
    libraryEntry: "lib/libpdfium.dylib",
    librarySha256:
      "1bc45b15466b34cef96641ce25c77a876e70010c6b114f909dda2f5325fc5bd7"
  },
  "x86_64-apple-darwin": {
    archive: "pdfium-mac-x64.tgz",
    archiveSha256:
      "6dedf83990e0e3d6b7c93c9e7589c5a126b0ae14b7464d76120cff7a26afb18b",
    libraryEntry: "lib/libpdfium.dylib",
    librarySha256:
      "4eaad6c3e8d786cf6f66a45d7d014edf5c65f372f98c3070e66595ebb50e43d9"
  },
  "x86_64-pc-windows-msvc": {
    archive: "pdfium-win-x64.tgz",
    archiveSha256:
      "73cc0de638ac2095e7445bf56a38200a5b7c7ca0e9f4ba144598f2457377ac08",
    libraryEntry: "bin/pdfium.dll",
    librarySha256:
      "79d4676b656cfb1abcea88f9ade3b4b0826c5200382db5f4ec72a636c598c118"
  },
  "x86_64-unknown-linux-gnu": {
    archive: "pdfium-linux-x64.tgz",
    archiveSha256:
      "1470e21b8b4a3b4ad7f85684e2da11d94f3b69a86d81dee11b9b6709d927ac1d",
    libraryEntry: "lib/libpdfium.so",
    librarySha256:
      "f728930966f503652b92acc89b9374a2eeca00ce42e26dccd3e4b5c5161b2d64"
  }
};

// `${process.platform}-${process.arch}` → target triple
const HOST_TARGETS = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu"
};

// 라이브러리와 함께 꺼내는 항목(아카이브 안 경로 그대로 둔다)
const LICENSE_FILE_ENTRY = "LICENSE";
const LICENSE_DIRECTORY_PREFIX = "licenses/";
const VERSION_FILE_ENTRY = "VERSION";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = resolve(SCRIPT_DIRECTORY, "../src-tauri/pdfium");
const STAGING_SUFFIX = ".partial";

// tar(ustar) 헤더 배치
const TAR_BLOCK_SIZE = 512;
const TAR_NAME = { offset: 0, length: 100 };
const TAR_SIZE = { offset: 124, length: 12 };
const TAR_TYPE_OFFSET = 156;
const TAR_MAGIC = { offset: 257, length: 5, value: "ustar" };
const TAR_PREFIX = { offset: 345, length: 155 };
const TAR_TYPE = {
  FILE: "0",
  LEGACY_FILE: "\0",
  PAX_HEADER: "x",
  GNU_LONG_NAME: "L"
};
const OCTAL_RADIX = 8;
const PAX_PATH_KEY = "path";

const sha256 = ({ data }) => createHash("sha256").update(data).digest("hex");

const readTarString = ({ block, field }) => {
  const raw = block.subarray(field.offset, field.offset + field.length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
};

const readPaxPath = ({ data }) => {
  const records = data.toString("utf8").split("\n");
  const pathRecord = records
    .map((record) => record.slice(record.indexOf(" ") + 1))
    .find((record) => record.startsWith(`${PAX_PATH_KEY}=`));
  return pathRecord?.slice(PAX_PATH_KEY.length + 1);
};

const readEntryName = ({ block }) => {
  const name = readTarString({ block, field: TAR_NAME });
  const isUstar =
    readTarString({ block, field: TAR_MAGIC }) === TAR_MAGIC.value;
  const prefix = isUstar ? readTarString({ block, field: TAR_PREFIX }) : "";
  return prefix ? `${prefix}/${name}` : name;
};

// 일반 파일 항목만 { name, data } 로 돌려준다.
const readTarFiles = ({ tar }) => {
  const files = [];
  let offset = 0;
  let pendingName;
  while (offset + TAR_BLOCK_SIZE <= tar.length) {
    const block = tar.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (block.every((byte) => byte === 0)) {
      break;
    }
    const size = Number.parseInt(
      readTarString({ block, field: TAR_SIZE }).trim() || "0",
      OCTAL_RADIX
    );
    const dataStart = offset + TAR_BLOCK_SIZE;
    const data = tar.subarray(dataStart, dataStart + size);
    const type = String.fromCharCode(block[TAR_TYPE_OFFSET]);
    if (type === TAR_TYPE.PAX_HEADER) {
      pendingName = readPaxPath({ data }) ?? pendingName;
    } else if (type === TAR_TYPE.GNU_LONG_NAME) {
      pendingName = readTarString({
        block: data,
        field: { offset: 0, length: data.length }
      });
    } else {
      const name = (pendingName ?? readEntryName({ block })).replace(
        /^\.\//,
        ""
      );
      pendingName = undefined;
      if (type === TAR_TYPE.FILE || type === TAR_TYPE.LEGACY_FILE) {
        files.push({ name, data });
      }
    }
    offset = dataStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }
  return files;
};

const isWantedEntry = ({ name, spec }) =>
  name === spec.libraryEntry ||
  name === LICENSE_FILE_ENTRY ||
  name === VERSION_FILE_ENTRY ||
  (name.startsWith(LICENSE_DIRECTORY_PREFIX) &&
    name.length > LICENSE_DIRECTORY_PREFIX.length);

// 라이브러리는 대상 폴더 바로 아래, 나머지는 아카이브 안 경로 그대로
const outputPathFor = ({ name, spec, directory }) =>
  name === spec.libraryEntry
    ? join(directory, basename(name))
    : join(directory, ...name.split("/"));

const resolveTarget = () => {
  const { values } = parseArgs({ options: { target: { type: "string" } } });
  const target =
    values.target ?? HOST_TARGETS[`${process.platform}-${process.arch}`];
  if (!target || !(target in TARGETS)) {
    const supported = Object.keys(TARGETS).join(", ");
    throw new Error(
      `지원하지 않는 타깃: ${target ?? `${process.platform}-${process.arch}`}` +
        ` (지원: ${supported})`
    );
  }
  return target;
};

const isAlreadyInstalled = ({ spec, directory }) => {
  const libraryPath = join(directory, basename(spec.libraryEntry));
  return (
    existsSync(libraryPath) &&
    existsSync(join(directory, LICENSE_FILE_ENTRY)) &&
    sha256({ data: readFileSync(libraryPath) }) === spec.librarySha256
  );
};

const download = async ({ url }) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`내려받기 실패 ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const verifyHash = ({ label, data, expected }) => {
  const actual = sha256({ data });
  if (actual !== expected) {
    throw new Error(
      `${label} SHA-256 불일치: 기대 ${expected}, 실제 ${actual}`
    );
  }
};

const install = ({ spec, archive, directory }) => {
  const files = readTarFiles({ tar: gunzipSync(archive) }).filter(({ name }) =>
    isWantedEntry({ name, spec })
  );
  const library = files.find(({ name }) => name === spec.libraryEntry);
  if (!library) {
    throw new Error(`아카이브에 ${spec.libraryEntry} 없음`);
  }
  verifyHash({
    label: spec.libraryEntry,
    data: library.data,
    expected: spec.librarySha256
  });

  const staging = `${directory}${STAGING_SUFFIX}`;
  rmSync(staging, { recursive: true, force: true });
  files.forEach(({ name, data }) => {
    const outputPath = outputPathFor({ name, spec, directory: staging });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, data);
  });
  rmSync(directory, { recursive: true, force: true });
  renameSync(staging, directory);
};

const main = async () => {
  const target = resolveTarget();
  const spec = TARGETS[target];
  const directory = join(OUTPUT_ROOT, target);

  if (isAlreadyInstalled({ spec, directory })) {
    console.log(
      `pdfium ${PDFIUM_RELEASE_TAG} (${target}) 이미 있음: ${directory}`
    );
    return;
  }

  const url = `${RELEASE_BASE_URL}/${spec.archive}`;
  console.log(`pdfium ${PDFIUM_RELEASE_TAG} (${target}) 내려받는 중: ${url}`);
  const archive = await download({ url });
  verifyHash({
    label: spec.archive,
    data: archive,
    expected: spec.archiveSha256
  });
  install({ spec, archive, directory });
  console.log(`pdfium 설치 완료: ${directory}`);
};

main().catch((error) => {
  console.error(`fetch-pdfium 실패: ${error.message}`);
  process.exit(1);
});
