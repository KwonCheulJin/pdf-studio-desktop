#!/usr/bin/env node

// OCR에 쓰는 ONNX Runtime 동적 라이브러리와 PaddleOCR(PP-OCRv5) ONNX 모델을 버전 고정으로 받아
// SHA-256을 검증한다. 라이브러리는 src-tauri/onnxruntime/<target-triple>/, 모델은 src-tauri/ocr-models/ 에 둔다.
// 사용: node scripts/fetch-ocr.mjs [--target <target-triple>]

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
import { gunzipSync, inflateRawSync } from "node:zlib";

// ort 2.0.0-rc.13 이 맞춰 둔 ONNX Runtime 버전이다. ort를 올릴 때 함께 올린다.
const ONNXRUNTIME_VERSION = "1.28.3";
const ONNXRUNTIME_BASE_URL = `https://github.com/microsoft/onnxruntime/releases/download/v${ONNXRUNTIME_VERSION}`;

const ARCHIVE_KIND = { TGZ: "tgz", ZIP: "zip" };

// archiveSha256: GitHub 릴리스 자산의 digest 값(내려받아 같은 값임을 확인함)
// librarySha256: 아카이브 안 라이브러리 파일의 SHA-256
// libraryFile: 꺼내서 둘 이름(pdf-core가 플랫폼별로 찾는 이름)
// x86_64-apple-darwin 은 ONNX Runtime 1.28 공식 릴리스에 없다.
const ONNXRUNTIME_TARGETS = {
  "aarch64-apple-darwin": {
    archive: `onnxruntime-osx-arm64-${ONNXRUNTIME_VERSION}.tgz`,
    archiveKind: ARCHIVE_KIND.TGZ,
    archiveSha256:
      "c436bd9f47dbce6f6311ccc21de97f829b3c862c09d24aa321958cb72f0a1d32",
    libraryEntry: `lib/libonnxruntime.${ONNXRUNTIME_VERSION}.dylib`,
    libraryFile: "libonnxruntime.dylib",
    librarySha256:
      "0c8707e83b3389849d03a3264308e905169b94b546f84df6bf662649bd89c3bb"
  },
  "x86_64-pc-windows-msvc": {
    archive: `onnxruntime-win-x64-${ONNXRUNTIME_VERSION}.zip`,
    archiveKind: ARCHIVE_KIND.ZIP,
    archiveSha256:
      "1d6fab48e85f948436af7c8c971d2c145cf224e2c444755dec894f8b0de11a83",
    libraryEntry: "lib/onnxruntime.dll",
    libraryFile: "onnxruntime.dll",
    librarySha256:
      "4d2774a5f64e4a230b16b74b167171e92f65b0683c19680c1d04fb284b92a6e2"
  },
  "x86_64-unknown-linux-gnu": {
    archive: `onnxruntime-linux-x64-${ONNXRUNTIME_VERSION}.tgz`,
    archiveKind: ARCHIVE_KIND.TGZ,
    archiveSha256:
      "db14e4863bd37893fc59729d986ab2a0d043d10b7d44da1913c4982b7e3d009c",
    libraryEntry: `lib/libonnxruntime.so.${ONNXRUNTIME_VERSION}`,
    libraryFile: "libonnxruntime.so",
    librarySha256:
      "5a1ce74e56e8c4b278d5a9e9d12b7192d9f70811084dde9616da4fa1710efc5a"
  }
};

// 라이브러리와 함께 꺼내는 고지 파일(아카이브 최상위 폴더 기준 경로)
const ONNXRUNTIME_NOTICE_ENTRIES = [
  "LICENSE",
  "ThirdPartyNotices.txt",
  "VERSION_NUMBER"
];

// RapidOCR 가 PaddleOCR 모델을 ONNX로 바꿔 ModelScope 에 올린 배포본(Apache-2.0).
// 주소의 v3.10.0 은 RapidOCR 모델 저장소의 태그이고, SHA-256은 RapidOCR default_models.yaml 값과 같다.
const MODEL_BASE_URL =
  "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0";
const MODELS = [
  {
    file: "ch_PP-OCRv5_det_mobile.onnx",
    path: "onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx",
    sha256: "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae"
  },
  {
    file: "korean_PP-OCRv5_rec_mobile.onnx",
    path: "onnx/PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile.onnx",
    sha256: "cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b"
  },
  {
    file: "ppocrv5_korean_dict.txt",
    path: "paddle/PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile/ppocrv5_korean_dict.txt",
    sha256: "a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7"
  }
];

// `${process.platform}-${process.arch}` → target triple
const HOST_TARGETS = {
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu"
};

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ONNXRUNTIME_OUTPUT_ROOT = resolve(
  SCRIPT_DIRECTORY,
  "../src-tauri/onnxruntime"
);
const MODEL_OUTPUT_DIRECTORY = resolve(SCRIPT_DIRECTORY, "../src-tauri/ocr-models");
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

// zip 구조(APPNOTE 4.3). ZIP64 는 쓰지 않는 아카이브만 받는다.
const ZIP_END_OF_CENTRAL_DIRECTORY = {
  signature: 0x06054b50,
  minimumSize: 22,
  maximumCommentLength: 0xffff,
  entryCountOffset: 10,
  directoryOffsetOffset: 16
};
const ZIP_CENTRAL_ENTRY = {
  signature: 0x02014b50,
  methodOffset: 10,
  compressedSizeOffset: 20,
  nameLengthOffset: 28,
  extraLengthOffset: 30,
  commentLengthOffset: 32,
  localHeaderOffsetOffset: 42,
  headerSize: 46
};
const ZIP_LOCAL_HEADER = {
  signature: 0x04034b50,
  nameLengthOffset: 26,
  extraLengthOffset: 28,
  headerSize: 30
};
const ZIP_METHOD = { STORED: 0, DEFLATED: 8 };
const ZIP64_MARKER = 0xffffffff;

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

const findEndOfCentralDirectory = ({ zip }) => {
  const earliest = Math.max(
    0,
    zip.length -
      ZIP_END_OF_CENTRAL_DIRECTORY.minimumSize -
      ZIP_END_OF_CENTRAL_DIRECTORY.maximumCommentLength
  );
  for (
    let offset = zip.length - ZIP_END_OF_CENTRAL_DIRECTORY.minimumSize;
    offset >= earliest;
    offset -= 1
  ) {
    if (zip.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY.signature) {
      return offset;
    }
  }
  throw new Error("zip 끝 레코드를 찾지 못함");
};

const readZipEntryData = ({ zip, method, compressedSize, localOffset }) => {
  if (zip.readUInt32LE(localOffset) !== ZIP_LOCAL_HEADER.signature) {
    throw new Error(`zip 로컬 헤더가 아님: ${localOffset}`);
  }
  const dataStart =
    localOffset +
    ZIP_LOCAL_HEADER.headerSize +
    zip.readUInt16LE(localOffset + ZIP_LOCAL_HEADER.nameLengthOffset) +
    zip.readUInt16LE(localOffset + ZIP_LOCAL_HEADER.extraLengthOffset);
  const raw = zip.subarray(dataStart, dataStart + compressedSize);
  if (method === ZIP_METHOD.STORED) {
    return raw;
  }
  if (method === ZIP_METHOD.DEFLATED) {
    return inflateRawSync(raw);
  }
  throw new Error(`지원하지 않는 zip 압축 방식: ${method}`);
};

// 이름이 wanted(name) 를 만족하는 항목만 풀어 { name, data } 로 돌려준다(큰 항목을 다 풀지 않으려고).
const readZipFiles = ({ zip, wanted }) => {
  const end = findEndOfCentralDirectory({ zip });
  const entryCount = zip.readUInt16LE(
    end + ZIP_END_OF_CENTRAL_DIRECTORY.entryCountOffset
  );
  let offset = zip.readUInt32LE(
    end + ZIP_END_OF_CENTRAL_DIRECTORY.directoryOffsetOffset
  );
  const files = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(offset) !== ZIP_CENTRAL_ENTRY.signature) {
      throw new Error(`zip 중앙 디렉터리 항목이 아님: ${offset}`);
    }
    const nameLength = zip.readUInt16LE(
      offset + ZIP_CENTRAL_ENTRY.nameLengthOffset
    );
    const name = zip
      .subarray(
        offset + ZIP_CENTRAL_ENTRY.headerSize,
        offset + ZIP_CENTRAL_ENTRY.headerSize + nameLength
      )
      .toString("utf8");
    const compressedSize = zip.readUInt32LE(
      offset + ZIP_CENTRAL_ENTRY.compressedSizeOffset
    );
    const localOffset = zip.readUInt32LE(
      offset + ZIP_CENTRAL_ENTRY.localHeaderOffsetOffset
    );
    if (wanted(name)) {
      if (compressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER) {
        throw new Error(`ZIP64 항목은 지원하지 않음: ${name}`);
      }
      files.push({
        name,
        data: readZipEntryData({
          zip,
          method: zip.readUInt16LE(offset + ZIP_CENTRAL_ENTRY.methodOffset),
          compressedSize,
          localOffset
        })
      });
    }
    offset +=
      ZIP_CENTRAL_ENTRY.headerSize +
      nameLength +
      zip.readUInt16LE(offset + ZIP_CENTRAL_ENTRY.extraLengthOffset) +
      zip.readUInt16LE(offset + ZIP_CENTRAL_ENTRY.commentLengthOffset);
  }
  return files;
};

// 아카이브는 최상위 폴더(onnxruntime-<os>-<arch>-<version>/) 하나를 갖는다. 그 아래 경로로 비교한다.
const withoutTopDirectory = ({ name }) => name.slice(name.indexOf("/") + 1);

const isWantedEntry = ({ name, spec }) => {
  const relative = withoutTopDirectory({ name });
  return (
    relative === spec.libraryEntry ||
    ONNXRUNTIME_NOTICE_ENTRIES.includes(relative)
  );
};

const readArchiveFiles = ({ spec, archive }) => {
  const wanted = (name) => isWantedEntry({ name, spec });
  const files =
    spec.archiveKind === ARCHIVE_KIND.ZIP
      ? readZipFiles({ zip: archive, wanted })
      : readTarFiles({ tar: gunzipSync(archive) }).filter(({ name }) =>
          wanted(name)
        );
  return files.map(({ name, data }) => ({
    name: withoutTopDirectory({ name }),
    data
  }));
};

const resolveTarget = () => {
  const { values } = parseArgs({ options: { target: { type: "string" } } });
  const target =
    values.target ?? HOST_TARGETS[`${process.platform}-${process.arch}`];
  if (!target || !(target in ONNXRUNTIME_TARGETS)) {
    const supported = Object.keys(ONNXRUNTIME_TARGETS).join(", ");
    throw new Error(
      `지원하지 않는 타깃: ${target ?? `${process.platform}-${process.arch}`}` +
        ` (지원: ${supported})`
    );
  }
  return target;
};

const hasFileWithHash = ({ path, expected }) =>
  existsSync(path) && sha256({ data: readFileSync(path) }) === expected;

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

// 받은 파일을 임시 이름으로 쓴 뒤 rename 한다(중간에 멈춰도 검증 안 된 파일이 남지 않게).
const writeAtomically = ({ path, data }) => {
  const staging = `${path}${STAGING_SUFFIX}`;
  writeFileSync(staging, data);
  renameSync(staging, path);
};

const installOnnxRuntime = async ({ target }) => {
  const spec = ONNXRUNTIME_TARGETS[target];
  const directory = join(ONNXRUNTIME_OUTPUT_ROOT, target);
  const libraryPath = join(directory, spec.libraryFile);
  if (hasFileWithHash({ path: libraryPath, expected: spec.librarySha256 })) {
    console.log(
      `ONNX Runtime ${ONNXRUNTIME_VERSION} (${target}) 이미 있음: ${directory}`
    );
    return;
  }

  const url = `${ONNXRUNTIME_BASE_URL}/${spec.archive}`;
  console.log(
    `ONNX Runtime ${ONNXRUNTIME_VERSION} (${target}) 내려받는 중: ${url}`
  );
  const archive = await download({ url });
  verifyHash({
    label: spec.archive,
    data: archive,
    expected: spec.archiveSha256
  });
  const files = readArchiveFiles({ spec, archive });
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
  mkdirSync(staging, { recursive: true });
  files.forEach(({ name, data }) => {
    const fileName =
      name === spec.libraryEntry ? spec.libraryFile : basename(name);
    writeFileSync(join(staging, fileName), data);
  });
  rmSync(directory, { recursive: true, force: true });
  renameSync(staging, directory);
  console.log(`ONNX Runtime 설치 완료: ${directory}`);
};

const installModels = async () => {
  mkdirSync(MODEL_OUTPUT_DIRECTORY, { recursive: true });
  for (const model of MODELS) {
    const path = join(MODEL_OUTPUT_DIRECTORY, model.file);
    if (hasFileWithHash({ path, expected: model.sha256 })) {
      console.log(`OCR 모델 이미 있음: ${model.file}`);
      continue;
    }
    const url = `${MODEL_BASE_URL}/${model.path}`;
    console.log(`OCR 모델 내려받는 중: ${url}`);
    const data = await download({ url });
    verifyHash({ label: model.file, data, expected: model.sha256 });
    writeAtomically({ path, data });
  }
  console.log(`OCR 모델 준비 완료: ${MODEL_OUTPUT_DIRECTORY}`);
};

const main = async () => {
  const target = resolveTarget();
  await installOnnxRuntime({ target });
  await installModels();
};

main().catch((error) => {
  console.error(`fetch-ocr 실패: ${error.message}`);
  process.exit(1);
});
