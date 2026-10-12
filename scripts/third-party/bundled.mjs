// 앱에 함께 들어가는 바이너리·자산의 고정 목록. Rust·npm 의존성 목록에 잡히지 않거나
// (pdfium, ONNX Runtime, OCR 모델) 패키지 안 하위 폴더에 따로 라이선스가 있는 것(pdf.js 자산)이다.
// 버전·출처는 scripts/fetch-pdfium.mjs, scripts/fetch-ocr.mjs 와 함께 올린다.

import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ECOSYSTEM } from "./policy.mjs";
import { readText, ROOT } from "./text.mjs";

// fetch-pdfium.mjs 의 PDFIUM_RELEASE_TAG
const PDFIUM_RELEASE_TAG = "chromium/7881";
// 라이선스 원문을 읽을 pdfium 타깃. 타깃마다 원문 내용은 같고 줄 끝·주석 기호만 달라
// 한 타깃으로 고정해야 어느 OS에서 만들어도 같은 고지가 나온다.
export const PDFIUM_NOTICE_TARGET = "aarch64-apple-darwin";
const PDFIUM_DIRECTORY = join(
  ROOT,
  "src-tauri",
  "pdfium",
  PDFIUM_NOTICE_TARGET
);

// fetch-ocr.mjs 의 ONNXRUNTIME_VERSION, MODEL_BASE_URL 태그
const ONNXRUNTIME_VERSION = "1.28.3";
const RAPIDOCR_MODEL_TAG = "v3.10.0";

const ONNXRUNTIME_LICENSE = `MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const OCR_MODEL_NOTICE = `PaddleOCR PP-OCRv5 models
Copyright (c) 2016 PaddlePaddle Authors. All Rights Reserved.
Licensed under the Apache License, Version 2.0.
https://github.com/PaddlePaddle/PaddleOCR

ONNX conversion by RapidOCR
Copyright (c) 2021 RapidOCR Authors. All rights reserved.
Licensed under the Apache License, Version 2.0.
https://github.com/RapidAI/RapidOCR`;

const require = createRequire(join(ROOT, "package.json"));

function packageDirectory(name) {
  return dirname(require.resolve(`${name}/package.json`));
}

function packageVersion(name) {
  return require(`${name}/package.json`).version;
}

function fileText(path) {
  return { name: path.split(/[\\/]/).at(-1), content: readText(path) };
}

function pdfiumTexts() {
  if (!existsSync(PDFIUM_DIRECTORY)) {
    throw new Error(
      `pdfium 라이선스 원문이 없다. 먼저 받는다: node scripts/fetch-pdfium.mjs --target ${PDFIUM_NOTICE_TARGET}`
    );
  }
  const licensesDirectory = join(PDFIUM_DIRECTORY, "licenses");
  return [
    fileText(join(PDFIUM_DIRECTORY, "LICENSE")),
    ...readdirSync(licensesDirectory)
      .sort()
      .map((fileName) => fileText(join(licensesDirectory, fileName)))
  ];
}

/** 고정 목록을 구성요소로 만든다. 파일 원문은 지금 설치된 패키지·받아 둔 바이너리에서 읽는다. */
export function bundledComponents() {
  const pdfjs = packageDirectory("pdfjs-dist");
  const pdfjsVersion = packageVersion("pdfjs-dist");
  const pdfjsAsset = (relativePath) => fileText(join(pdfjs, relativePath));
  const pdfjsSource = "https://github.com/mozilla/pdf.js";
  const pdfjsComponent = ({ name, license, files }) => ({
    ecosystem: ECOSYSTEM.BUNDLED,
    name,
    version: pdfjsVersion,
    license,
    source: pdfjsSource,
    texts: files.map(pdfjsAsset)
  });

  return [
    {
      ecosystem: ECOSYSTEM.BUNDLED,
      name: "pdfium",
      version: PDFIUM_RELEASE_TAG,
      license: "BSD-3-Clause",
      source: "https://github.com/bblanchon/pdfium-binaries",
      note: "bblanchon/pdfium-binaries 배포본. 배포본의 패키징 라이선스(MIT)와 pdfium·하위 구성요소(FreeType, ICU, libjpeg-turbo, libpng, libtiff, OpenJPEG, Little CMS, zlib, Abseil 등) 라이선스 원문을 함께 싣는다.",
      texts: pdfiumTexts()
    },
    {
      ecosystem: ECOSYSTEM.BUNDLED,
      name: "ONNX Runtime",
      version: ONNXRUNTIME_VERSION,
      license: "MIT",
      source: "https://github.com/microsoft/onnxruntime",
      note: "스캔 문서 OCR 추론 런타임.",
      texts: [{ name: "LICENSE", content: ONNXRUNTIME_LICENSE }]
    },
    {
      ecosystem: ECOSYSTEM.BUNDLED,
      name: "PaddleOCR PP-OCRv5 모델 (ONNX 변환본)",
      version: `RapidOCR ${RAPIDOCR_MODEL_TAG}`,
      license: "Apache-2.0",
      source: "https://www.modelscope.cn/models/RapidAI/RapidOCR",
      note: "검출 ch_PP-OCRv5_det_mobile, 한국어 인식 korean_PP-OCRv5_rec_mobile, 사전 ppocrv5_korean_dict.txt.",
      texts: [
        { name: "NOTICE", content: OCR_MODEL_NOTICE },
        // Apache-2.0 원문. pdf.js 패키지의 LICENSE가 수정 없는 원문이다.
        pdfjsAsset("LICENSE")
      ]
    },
    {
      ecosystem: ECOSYSTEM.BUNDLED,
      name: "IBM Plex Sans KR · IBM Plex Mono",
      version: packageVersion("@fontsource/ibm-plex-sans-kr"),
      license: "OFL-1.1",
      source: "https://github.com/IBM/plex",
      note: "화면 글꼴. npm @fontsource/ibm-plex-sans-kr, @fontsource/ibm-plex-mono 로 번들한다.",
      texts: ["@fontsource/ibm-plex-sans-kr", "@fontsource/ibm-plex-mono"].map(
        (name) => fileText(join(packageDirectory(name), "LICENSE"))
      )
    },
    pdfjsComponent({
      name: "pdf.js CMap",
      license: "BSD-3-Clause",
      files: ["cmaps/LICENSE"]
    }),
    pdfjsComponent({
      name: "pdf.js 표준 글꼴: Foxit",
      license: "BSD-3-Clause",
      files: ["standard_fonts/LICENSE_FOXIT"]
    }),
    pdfjsComponent({
      name: "pdf.js 표준 글꼴: Liberation Sans",
      license: "OFL-1.1",
      files: ["standard_fonts/LICENSE_LIBERATION"]
    }),
    pdfjsComponent({
      name: "pdf.js wasm: JBIG2 디코더",
      license: "BSD-3-Clause AND Apache-2.0",
      files: ["wasm/LICENSE_JBIG2", "wasm/LICENSE_PDFJS_JBIG2"]
    }),
    pdfjsComponent({
      name: "pdf.js wasm: OpenJPEG 디코더",
      license: "BSD-2-Clause",
      files: ["wasm/LICENSE_OPENJPEG", "wasm/LICENSE_PDFJS_OPENJPEG"]
    }),
    pdfjsComponent({
      name: "pdf.js wasm: qcms 색 관리",
      license: "MIT AND BSD-2-Clause",
      files: ["wasm/LICENSE_QCMS", "wasm/LICENSE_PDFJS_QCMS"]
    }),
    pdfjsComponent({
      name: "pdf.js ICC 프로필",
      license: "CC0-1.0",
      files: ["iccs/LICENSE"]
    })
  ];
}
