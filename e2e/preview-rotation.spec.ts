import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { E2eMockFile } from "../src/renderer/app/providers/e2e-platform";
import type { PageInfo } from "../src/renderer/shared/api/bindings";

/**
 * 미리보기의 회전(계획서 P0-6). 미리보기는 스토어의 절대 회전으로 다시 그린다.
 * 세로(A4) 페이지를 90도 돌리면 미리보기 이미지가 가로로 길어져야 한다.
 * 픽스처의 세 페이지는 모두 `/Rotate` 없는 A4 세로다.
 */

const FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");
const FIXTURE_PAGE_COUNT = 3;

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

const PORTRAIT_FILE: E2eMockFile = {
  path: "/Users/e2e/originals/portrait.pdf",
  displayName: "portrait.pdf",
  pages: Array.from({ length: FIXTURE_PAGE_COUNT }, () => A4_PAGE),
  bytesBase64: readFileSync(
    path.join(FIXTURE_DIRECTORY, "three-pages.pdf")
  ).toString("base64")
};

const ORIENTATION = {
  PORTRAIT: "portrait",
  LANDSCAPE: "landscape"
} as const;

type Orientation = (typeof ORIENTATION)[keyof typeof ORIENTATION];

async function openWorkspace(page: Page): Promise<void> {
  await page.addInitScript(
    (files) => {
      window.__E2E_MOCK_SEED__ = { files };
    },
    [PORTRAIT_FILE]
  );
  await page.goto("/");
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(1);
}

/** 렌더된 이미지(PNG)의 실제 가로·세로로 본 방향. 다 그려질 때까지 기다린다. */
async function readOrientation(image: Locator): Promise<Orientation> {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.naturalWidth)
    )
    .toBeGreaterThan(0);
  const { naturalWidth, naturalHeight } = await image.evaluate(
    (element: HTMLImageElement) => ({
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight
    })
  );
  return naturalWidth > naturalHeight
    ? ORIENTATION.LANDSCAPE
    : ORIENTATION.PORTRAIT;
}

function previewDialog(page: Page): Locator {
  return page.getByRole("dialog");
}

test("목록 미리보기는 파일을 돌린 회전으로 그린다", async ({ page }) => {
  await openWorkspace(page);
  const documentCard = page.getByRole("button", {
    name: `${PORTRAIT_FILE.displayName} 문서`,
    exact: true
  });
  await documentCard.click();
  await page
    .getByRole("button", { name: "선택 항목 오른쪽으로 회전", exact: true })
    .click();

  await documentCard.hover();
  await documentCard
    .getByRole("button", { name: "미리보기 확대", exact: true })
    .click();

  const dialog = previewDialog(page);
  await expect(dialog).toBeVisible();
  expect(
    await readOrientation(
      dialog.getByRole("img", { name: "페이지 1", exact: true })
    )
  ).toBe(ORIENTATION.LANDSCAPE);
});

test("단일 페이지 미리보기는 그 페이지를 돌린 회전으로 그린다", async ({
  page
}) => {
  await openWorkspace(page);
  const documentCard = page.getByTestId("document-card");
  await documentCard.hover();
  await documentCard
    .getByRole("button", { name: "펼치기", exact: true })
    .click();
  const pageCards = page.getByTestId("page-card");
  await expect(pageCards).toHaveCount(FIXTURE_PAGE_COUNT);
  const secondPage = pageCards.nth(1);
  const previewImage = (pageNumber: number) =>
    previewDialog(page).getByRole("img", {
      name: `${PORTRAIT_FILE.displayName} 페이지 ${pageNumber}`,
      exact: true
    });

  // 돌리지 않은 첫 페이지는 세로 그대로
  const firstPage = pageCards.first();
  await firstPage.hover();
  await firstPage
    .getByRole("button", { name: "미리보기", exact: true })
    .click();
  expect(await readOrientation(previewImage(1))).toBe(ORIENTATION.PORTRAIT);
  await page.keyboard.press("Escape");
  await expect(previewDialog(page)).toHaveCount(0);

  await secondPage.hover();
  await secondPage
    .getByRole("button", { name: "시계 방향 회전", exact: true })
    .click();
  await secondPage
    .getByRole("button", { name: "미리보기", exact: true })
    .click();

  expect(await readOrientation(previewImage(2))).toBe(ORIENTATION.LANDSCAPE);
});
