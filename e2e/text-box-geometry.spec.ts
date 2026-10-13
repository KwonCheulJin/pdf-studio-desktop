import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { PageBox, Rotation } from "../src/renderer/shared/api/bindings";

/**
 * pdfium 글자 상자와 pdf.js 화면 위치의 일치(ADR 0001 §2·§8, 계획서 §6.2 1번 · Step 17).
 *
 * Rust golden(`crates/pdf-core/tests/golden/*.extract.json`)의 글자 상자를 pdf.js
 * `viewport.convertToViewportRectangle`로 바꾼 화면 사각형이, 같은 픽스처를 pdf.js로 연
 * `getTextContent()` 항목의 화면 사각형(항목 transform·width·글꼴 ascent/descent를 viewport
 * transform으로 옮긴 것) 안에 들고 그 항목의 기준선 방향 길이를 덮는지 본다. 원점을 보정하지 않고
 * 절대 사용자 공간 좌표를 그대로 넣어 맞아야 한다. golden의 `viewBox`·`rotation`은 pdf.js
 * `page.view`·`page.rotate`와 같아야 한다. pdf.js `getTextContent()`도 `page.view` 밖 글리프를
 * 빼므로, golden 글자(공백 제외)와 pdf.js 항목 글자가 빠짐없이 서로 짝지어져야 한다.
 *
 * 비교 화면은 아직 없다(Phase 3). 앱 화면 대신 개발 서버가 내주는 앱의 pdf.js 설정 모듈
 * (`shared/lib/pdfjs/pdfjs-setup.ts`: Worker·cMap 설정 그대로)을 페이지 안에서 `import()`로
 * 불러 쓰므로 앱에 테스트 전용 코드를 두지 않는다.
 */

const PDF_CORE_TEST_DIRECTORY = path.join(
  __dirname,
  "..",
  "crates",
  "pdf-core",
  "tests"
);
const PDFJS_SETUP_MODULE = "/src/renderer/shared/lib/pdfjs/pdfjs-setup.ts";
const VIEWPORT_SCALE = 1.5;
/**
 * golden 상자와 pdf.js 항목 사각형 사이 허용 오차(pt). tight 상자는 글리프 옆 여백(side bearing)만큼
 * 항목(전진 폭) 안쪽에 있다. 픽스처(9~18pt)에서 잰 최대 차이는 약 1.7pt('I'의 왼쪽 여백)다.
 * CropBox 원점(30pt 이상)·UserUnit(2배)·회전을 잘못 다루면 이보다 훨씬 크게 어긋난다.
 */
const BOX_TOLERANCE_PT = 3;
/** `page.view`와 golden `viewBox`는 같은 상자이므로 소수 둘째 자리까지 같아야 한다. */
const VIEW_BOX_DIGITS = 2;
/** pdf.js가 글꼴 ascent·descent를 모를 때 쓰는 값(em). TextLayer 기본 ascent와 같다. */
const FALLBACK_FONT_ASCENT = 0.8;
const FALLBACK_FONT_DESCENT = -0.2;

const FIXTURES = [
  {
    stem: "text-geometry",
    description:
      "CropBox 오프셋·MediaBox 원점·회전 90/180/270·UserUnit 2·상자 상속·교집합 없는 CropBox"
  },
  {
    stem: "korean-text",
    description: "한글 Identity-H CID 글꼴, 회전 270 + CropBox 오프셋"
  }
] as const;

type PdfjsSetupModule =
  typeof import("../src/renderer/shared/lib/pdfjs/pdfjs-setup");

/** Rust `TextBox` 직렬화 모양 */
interface GoldenTextBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rust `ExtractedChar`·`ExtractedPage` 직렬화 모양 */
interface GoldenChar {
  ch: string;
  glyph: { bounds: GoldenTextBox; fontSize: number } | null;
}

interface GoldenPage {
  size: { viewBox: PageBox; rotation: Rotation };
  chars: GoldenChar[];
  needsOcr: boolean;
}

/** 화면 좌표(px, 원점은 왼쪽 위, y는 아래로) */
interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type ScreenAxis = "x" | "y";

interface MeasuredItem {
  str: string;
  rect: ScreenRect;
  /** 기준선이 화면에서 놓인 축 */
  baselineAxis: ScreenAxis;
}

interface MeasuredPage {
  view: number[];
  rotate: number;
  userUnit: number;
  items: MeasuredItem[];
  /** golden 글자와 같은 순서. 상자가 없는 글자는 `null` */
  glyphRects: (ScreenRect | null)[];
}

/** `[x, y, w, h]` */
type BoundsTuple = [number, number, number, number];

interface MeasureArgs {
  /** 개발 서버 경로. 개발 서버가 TS를 변환해 내준다. */
  pdfjsSetupModule: string;
  pdfBase64: string;
  goldenBounds: (BoundsTuple | null)[][];
  scale: number;
  fallbackAscent: number;
  fallbackDescent: number;
}

function readGolden(stem: string): GoldenPage[] {
  const json = readFileSync(
    path.join(PDF_CORE_TEST_DIRECTORY, "golden", `${stem}.extract.json`),
    "utf-8"
  );
  return JSON.parse(json) as GoldenPage[];
}

function readFixtureBase64(stem: string): string {
  return readFileSync(
    path.join(PDF_CORE_TEST_DIRECTORY, "fixtures", `${stem}.pdf`)
  ).toString("base64");
}

/** 브라우저에서 돈다. 바깥 변수를 쓰지 않는다(Playwright가 함수 본문만 넘긴다). */
async function measurePages({
  pdfjsSetupModule,
  pdfBase64,
  goldenBounds,
  scale,
  fallbackAscent,
  fallbackDescent
}: MeasureArgs): Promise<MeasuredPage[]> {
  const { openPdfDocument }: PdfjsSetupModule = await import(pdfjsSetupModule);
  const toScreenRect = (points: number[][]): ScreenRect => {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys)
    };
  };
  const applyTransform = (matrix: number[], x: number, y: number): number[] => [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5]
  ];

  const bytes = Uint8Array.from(atob(pdfBase64), (character) =>
    character.charCodeAt(0)
  );
  const loadingTask = openPdfDocument(bytes);
  try {
    const document = await loadingTask.promise;
    const pages: MeasuredPage[] = [];
    for (let index = 0; index < document.numPages; index += 1) {
      const pdfPage = await document.getPage(index + 1);
      const viewport = pdfPage.getViewport({ scale });
      const content = await pdfPage.getTextContent();
      const items: MeasuredItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") {
          continue;
        }
        // transform = 기준선 시작점과 글자 축(글꼴 크기 포함), 사용자 공간.
        // width는 기준선 방향 길이, height는 글꼴 크기(사용자 공간 단위)다.
        const [a, b, c, d, e, f] = item.transform as number[];
        const alongLength = Math.hypot(a, b);
        const upLength = Math.hypot(c, d);
        const style = content.styles[item.fontName];
        const ascent = (style?.ascent || fallbackAscent) * item.height;
        const descent = (style?.descent || fallbackDescent) * item.height;
        const corners = [
          [0, descent],
          [item.width, descent],
          [item.width, ascent],
          [0, ascent]
        ].map(([along, up]) =>
          applyTransform(
            viewport.transform,
            e + (a / alongLength) * along + (c / upLength) * up,
            f + (b / alongLength) * along + (d / upLength) * up
          )
        );
        const [deltaX, deltaY] = [
          viewport.transform[0] * a + viewport.transform[2] * b,
          viewport.transform[1] * a + viewport.transform[3] * b
        ];
        items.push({
          str: item.str,
          rect: toScreenRect(corners),
          baselineAxis: Math.abs(deltaX) >= Math.abs(deltaY) ? "x" : "y"
        });
      }
      const glyphRects = (goldenBounds[index] ?? []).map((bounds) => {
        if (!bounds) {
          return null;
        }
        const [x, y, w, h] = bounds;
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
          x,
          y,
          x + w,
          y + h
        ]);
        return toScreenRect([
          [x1, y1],
          [x2, y2]
        ]);
      });
      pages.push({
        view: [...pdfPage.view],
        rotate: pdfPage.rotate,
        userUnit: pdfPage.userUnit,
        items,
        glyphRects
      });
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

function contains(
  outer: ScreenRect,
  inner: ScreenRect,
  tolerance: number
): boolean {
  return (
    inner.left >= outer.left - tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.bottom <= outer.bottom + tolerance
  );
}

function extentOn(rect: ScreenRect, axis: ScreenAxis): [number, number] {
  return axis === "x" ? [rect.left, rect.right] : [rect.top, rect.bottom];
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s/g, "");
}

function isWhitespace(character: string): boolean {
  return withoutWhitespace(character) === "";
}

interface ExpectPageParams {
  golden: GoldenPage;
  measured: MeasuredPage;
  label: string;
}

function expectPageMatchesPdfjs({
  golden,
  measured,
  label
}: ExpectPageParams): void {
  const { left, bottom, right, top } = golden.size.viewBox;
  [left, bottom, right, top].forEach((value, index) => {
    expect(measured.view[index], `${label} page.view[${index}]`).toBeCloseTo(
      value,
      VIEW_BOX_DIGITS
    );
  });
  expect(measured.rotate, `${label} page.rotate`).toBe(golden.size.rotation);

  const tolerance = BOX_TOLERANCE_PT * VIEWPORT_SCALE * measured.userUnit;
  const glyphsByItem = measured.items.map((): number[] => []);
  golden.chars.forEach(({ ch }, charIndex) => {
    const glyphRect = measured.glyphRects[charIndex];
    if (!glyphRect || isWhitespace(ch)) {
      return;
    }
    const itemIndex = measured.items.findIndex(
      (item) =>
        item.str.includes(ch) && contains(item.rect, glyphRect, tolerance)
    );
    expect(
      itemIndex,
      `${label} 글자 ${charIndex} "${ch}"가 pdf.js 텍스트 항목 안에 있다`
    ).toBeGreaterThanOrEqual(0);
    glyphsByItem[itemIndex].push(charIndex);
  });

  measured.items.forEach((item, itemIndex) => {
    const glyphIndexes = glyphsByItem[itemIndex];
    const itemLabel = `${label} 항목 "${item.str}"`;
    expect(glyphIndexes.length, `${itemLabel}: golden 글자`).toBeGreaterThan(0);
    const goldenText = glyphIndexes.map((index) => golden.chars[index].ch);
    expect(goldenText.join(""), `${itemLabel}: 글자`).toBe(
      withoutWhitespace(item.str)
    );
    const [itemStart, itemEnd] = extentOn(item.rect, item.baselineAxis);
    const glyphExtents = glyphIndexes.map((index) => {
      const glyphRect = measured.glyphRects[index];
      if (!glyphRect) {
        throw new Error(`${itemLabel}: 상자 없는 글자 ${index}`);
      }
      return extentOn(glyphRect, item.baselineAxis);
    });
    const glyphStart = Math.min(...glyphExtents.map(([start]) => start));
    const glyphEnd = Math.max(...glyphExtents.map(([, end]) => end));
    expect(
      Math.abs(glyphStart - itemStart),
      `${itemLabel}: 기준선 시작`
    ).toBeLessThanOrEqual(tolerance);
    expect(
      Math.abs(glyphEnd - itemEnd),
      `${itemLabel}: 기준선 끝`
    ).toBeLessThanOrEqual(tolerance);
  });
}

test.describe("pdfium 글자 상자 ↔ pdf.js 화면 위치", () => {
  for (const { stem, description } of FIXTURES) {
    test(`${stem}: ${description}`, async ({ page }) => {
      const golden = readGolden(stem);
      await page.goto("/");

      const measured = await page.evaluate(measurePages, {
        pdfjsSetupModule: PDFJS_SETUP_MODULE,
        pdfBase64: readFixtureBase64(stem),
        goldenBounds: golden.map((goldenPage) =>
          goldenPage.chars.map(({ glyph }): BoundsTuple | null =>
            glyph
              ? [glyph.bounds.x, glyph.bounds.y, glyph.bounds.w, glyph.bounds.h]
              : null
          )
        ),
        scale: VIEWPORT_SCALE,
        fallbackAscent: FALLBACK_FONT_ASCENT,
        fallbackDescent: FALLBACK_FONT_DESCENT
      });

      expect(measured).toHaveLength(golden.length);
      golden.forEach((goldenPage, pageIndex) => {
        expectPageMatchesPdfjs({
          golden: goldenPage,
          measured: measured[pageIndex],
          label: `${stem} ${pageIndex}쪽`
        });
      });
    });
  }
});
