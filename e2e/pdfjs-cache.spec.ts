import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { E2eMockFile } from "../src/renderer/app/providers/e2e-platform";
import type { PageInfo } from "../src/renderer/shared/api/bindings";
import type { PdfCacheStats } from "../src/renderer/shared/lib/pdfjs";

/**
 * pdf.js 로더 단일화와 렌더 캐시(계획서 P0-4).
 * mock 플랫폼의 `readPdf` 기록과 개발 서버 전용 캐시 조회로
 * "같은 파일은 한 번만 읽는다", "파일을 빼면 문서를 닫고 렌더 캐시를 비운다",
 * "cMap이 있어야 그려지는 한글 PDF가 그려진다"를 확인한다.
 */

const FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

interface SeedFileParams {
  fixtureName: string;
  pageCount: number;
}

function seedFile({ fixtureName, pageCount }: SeedFileParams): E2eMockFile {
  return {
    path: `/Users/e2e/originals/${fixtureName}`,
    displayName: fixtureName,
    pages: Array.from({ length: pageCount }, () => A4_PAGE),
    bytesBase64: readFileSync(
      path.join(FIXTURE_DIRECTORY, fixtureName)
    ).toString("base64")
  };
}

// 렌더만 하므로 쪽별 크기는 쪽 수만 맞으면 된다.
const PLAIN_FILE = seedFile({ fixtureName: "three-pages.pdf", pageCount: 3 });
const ROTATED_FILE = seedFile({
  fixtureName: "mixed-geometry.pdf",
  pageCount: 5
});
// generate_korean_cid.py: UniKS-UCS2-H + 비임베드 Adobe-Korea1 CIDFont
const KOREAN_FILE = seedFile({ fixtureName: "korean-cid.pdf", pageCount: 1 });

/** 글자가 없으면(흰 페이지) 0이다. 두 줄 다섯 글자면 수천 픽셀이 나온다. */
const MIN_DARK_PIXELS = 500;
const DARK_LUMINANCE = 128;
const CMAP_WARNING_PATTERN = /cmap/i;

async function openWorkspace(page: Page, files: E2eMockFile[]): Promise<void> {
  await page.addInitScript((seedFiles) => {
    window.__E2E_MOCK_SEED__ = { files: seedFiles };
  }, files);
  await page.goto("/");
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  for (const file of files) {
    await expectImageLoaded(documentThumbnail(page, file));
  }
}

/** 보이기만 하고 깨진 이미지(CSP 차단, revoke된 URL)로 통과하지 않도록 픽셀까지 확인한다. */
async function expectImageLoaded(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.naturalWidth)
    )
    .toBeGreaterThan(0);
}

function documentThumbnail(page: Page, file: E2eMockFile): Locator {
  return page.getByRole("img", {
    name: `${file.displayName} 미리보기`,
    exact: true
  });
}

function documentCard(page: Page, file: E2eMockFile): Locator {
  return page
    .getByTestId("document-card")
    .filter({ has: documentThumbnail(page, file) });
}

function pageCard(page: Page, file: E2eMockFile, pageNumber: number): Locator {
  return page.getByTestId("page-card").filter({
    has: page.getByRole("img", {
      name: `${file.displayName} 페이지 ${pageNumber}`,
      exact: true
    })
  });
}

interface CardActionParams {
  card: Locator;
  action: string;
}

/** 카드 버튼은 마우스를 올렸을 때만 눌린다. */
async function clickCardAction({
  card,
  action
}: CardActionParams): Promise<void> {
  await card.hover();
  await card.getByRole("button", { name: action, exact: true }).click();
}

async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function readCacheStats(page: Page): Promise<PdfCacheStats> {
  return page.evaluate(() => {
    const getStats = window.__E2E_PDF_CACHE_STATS__;
    if (!getStats) {
      throw new Error("E2E 캐시 조회 훅이 없습니다.");
    }
    return getStats();
  });
}

function countOf(values: string[], target: string): number {
  return values.filter((value) => value === target).length;
}

test("같은 파일은 펼치기·접기·미리보기를 오가도 한 번만 읽는다", async ({
  page
}) => {
  const files = [PLAIN_FILE, ROTATED_FILE];
  await openWorkspace(page, files);

  // 펼치기 → 모든 페이지 썸네일
  for (const file of files) {
    await clickCardAction({ card: documentCard(page, file), action: "펼치기" });
  }
  for (const pageNumber of [1, 2, 3]) {
    await expectImageLoaded(
      pageCard(page, PLAIN_FILE, pageNumber).getByRole("img")
    );
  }
  for (const pageNumber of [1, 2, 3, 4, 5]) {
    await expectImageLoaded(
      pageCard(page, ROTATED_FILE, pageNumber).getByRole("img")
    );
  }

  // 페이지 미리보기 열고 닫기
  await clickCardAction({
    card: pageCard(page, PLAIN_FILE, 2),
    action: "미리보기"
  });
  await expectImageLoaded(
    page
      .getByRole("dialog")
      .getByRole("img", { name: `${PLAIN_FILE.displayName} 페이지 2` })
  );
  await closeDialog(page);

  // 접기 → 문서 카드로
  const collapsibleCards = page
    .getByTestId("page-card")
    .filter({ has: page.getByRole("button", { name: "접기", exact: true }) });
  while ((await collapsibleCards.count()) > 0) {
    await clickCardAction({ card: collapsibleCards.first(), action: "접기" });
  }
  for (const file of files) {
    await expectImageLoaded(documentThumbnail(page, file));
  }

  // 문서 미리보기 열고 닫기
  await clickCardAction({
    card: documentCard(page, ROTATED_FILE),
    action: "미리보기 확대"
  });
  await expectImageLoaded(
    page.getByRole("dialog").getByRole("img", { name: "페이지 1", exact: true })
  );
  await closeDialog(page);

  const reads = await page.evaluate(() => window.__E2E_MOCK_READS__ ?? []);
  expect(
    files.map((file) => ({ path: file.path, reads: countOf(reads, file.path) }))
  ).toEqual(files.map((file) => ({ path: file.path, reads: 1 })));
});

test("파일을 빼면 그 파일의 문서를 닫고 렌더 캐시를 비운다", async ({
  page
}) => {
  await openWorkspace(page, [PLAIN_FILE, ROTATED_FILE]);

  // 빈 상태로 통과하지 않도록 지우기 전에 열려 있음을 확인한다.
  const before = await readCacheStats(page);
  expect(before.liveDocumentPaths).toContain(PLAIN_FILE.path);
  expect(countOf(before.renderedPagePaths, PLAIN_FILE.path)).toBeGreaterThan(0);

  await clickCardAction({
    card: documentCard(page, PLAIN_FILE),
    action: "파일 삭제"
  });
  await expect(documentCard(page, PLAIN_FILE)).toHaveCount(0);

  await expect
    .poll(async () => {
      const stats = await readCacheStats(page);
      return {
        isPlainLive: stats.liveDocumentPaths.includes(PLAIN_FILE.path),
        plainRenderedPages: countOf(stats.renderedPagePaths, PLAIN_FILE.path),
        isOtherLive: stats.liveDocumentPaths.includes(ROTATED_FILE.path)
      };
    })
    .toEqual({ isPlainLive: false, plainRenderedPages: 0, isOtherLive: true });
});

test("cMap이 필요한 한글(CID, 비임베드) PDF 썸네일에 글자가 그려진다", async ({
  page
}) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));

  await openWorkspace(page, [KOREAN_FILE]);

  const darkPixels = await documentThumbnail(page, KOREAN_FILE).evaluate(
    async (image: HTMLImageElement, darkLuminance) => {
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas 2D context를 만들 수 없습니다.");
      }
      // 투명 배경이 어둡게 세지 않도록 흰 바탕에 그린다.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const luminance =
          0.299 * data[offset] +
          0.587 * data[offset + 1] +
          0.114 * data[offset + 2];
        if (luminance < darkLuminance) {
          count += 1;
        }
      }
      return count;
    },
    DARK_LUMINANCE
  );

  expect(darkPixels).toBeGreaterThanOrEqual(MIN_DARK_PIXELS);
  expect(
    consoleMessages.filter((text) => CMAP_WARNING_PATTERN.test(text))
  ).toEqual([]);
});
