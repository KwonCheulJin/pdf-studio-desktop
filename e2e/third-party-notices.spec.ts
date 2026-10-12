import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { E2eMockSeed } from "../src/renderer/app/providers/e2e-platform";

/**
 * 앱 정보에서 제3자 고지 열기(계획서 P4-5).
 * 시드에 저장소의 `THIRD_PARTY_NOTICES.md`(앱 번들에 들어가는 그 파일)를 그대로 넣어,
 * 상태 바의 진입점으로 대화상자를 열고 고지 내용을 보고 닫는다.
 */

const NOTICES_PATH = path.join(__dirname, "..", "THIRD_PARTY_NOTICES.md");
const NOTICES_TITLE = "오픈소스 라이선스";
const RESOURCE_UNAVAILABLE_MESSAGE =
  "앱에 함께 들어 있는 파일을 읽지 못했습니다. 앱을 다시 설치해 주세요.";

async function seed(page: Page, thirdPartyNotices?: string): Promise<void> {
  const initialSeed: E2eMockSeed = { files: [], thirdPartyNotices };
  await page.addInitScript((value) => {
    window.__E2E_MOCK_SEED__ = value;
  }, initialSeed);
}

function noticesDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: NOTICES_TITLE });
}

test("상태 바에서 제3자 고지를 열어 내용을 보고 닫는다", async ({ page }) => {
  await seed(page, readFileSync(NOTICES_PATH, "utf8"));
  await page.goto("/");

  await page.getByRole("button", { name: NOTICES_TITLE }).click();
  const dialog = noticesDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("pdfium chromium/7881");
  await expect(dialog).toContainText("IBM Plex Sans KR");
  await expect(dialog).toContainText("ONNX Runtime");
  await expect(dialog).toContainText("PaddleOCR");
  await expect(dialog).toContainText("Rust 크레이트");

  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(dialog).toBeHidden();

  // 다시 열면 이미 읽은 내용을 그대로 보인다.
  await page.getByRole("button", { name: NOTICES_TITLE }).click();
  await expect(noticesDialog(page)).toContainText("pdfium chromium/7881");
  await page.keyboard.press("Escape");
  await expect(noticesDialog(page)).toBeHidden();
});

test("고지 파일을 읽지 못하면 코드의 문구를 보인다", async ({ page }) => {
  await seed(page);
  await page.goto("/");

  await page.getByRole("button", { name: NOTICES_TITLE }).click();
  const alert = noticesDialog(page).getByRole("alert");
  await expect(alert).toHaveText(RESOURCE_UNAVAILABLE_MESSAGE);
});
