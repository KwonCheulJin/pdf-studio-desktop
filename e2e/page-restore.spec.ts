import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type { PageInfo } from "../src/renderer/shared/api/bindings";

/**
 * 페이지 삭제·복원(계획서 P0-6 B10)과 병합 요청에서 삭제 페이지 제외(B14).
 * 삭제한 페이지는 병합 순서의 제자리에 "삭제됨"으로 남고, 복원하면 그 자리로 돌아온다.
 * 순서는 화면이 아니라 mock 플랫폼에 기록된 병합 요청으로 확인한다.
 */

const FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");
const FIXTURE_NAME = "three-pages.pdf";
const FIXTURE_PAGE_COUNT = 3;

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

/** 같은 픽스처를 다른 경로·이름으로 연다. */
function seedFile(displayName: string): E2eMockFile {
  return {
    path: `/Users/e2e/originals/${displayName}`,
    displayName,
    pages: Array.from({ length: FIXTURE_PAGE_COUNT }, () => A4_PAGE),
    bytesBase64: readFileSync(
      path.join(FIXTURE_DIRECTORY, FIXTURE_NAME)
    ).toString("base64")
  };
}

const FILE_A = seedFile("alpha.pdf");
const FILE_B = seedFile("bravo.pdf");
const SEED_FILES = [FILE_A, FILE_B];

const DELETED_BADGE = "삭제됨";

function pageName(file: E2eMockFile, pageNumber: number): string {
  return `${file.displayName} ${pageNumber}쪽`;
}

/** 정렬 카드(펼친 페이지 카드·접힌 문서 카드를 감싼다). 이름은 스크린 리더가 읽는 카드 이름 */
function sortableCard(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

/** 정렬 카드 이름을 화면 순서(= 병합 순서)대로 읽는다. */
async function readCardOrder(page: Page): Promise<string[]> {
  return page
    .locator("[aria-roledescription]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label") ?? "")
    );
}

/** 카드 버튼은 마우스를 올렸을 때만 눌린다. */
async function clickCardAction(card: Locator, action: string): Promise<void> {
  await card.hover();
  await card.getByRole("button", { name: action, exact: true }).click();
}

async function expandAll(page: Page): Promise<void> {
  const documentCards = page.getByTestId("document-card");
  while ((await documentCards.count()) > 0) {
    await clickCardAction(documentCards.first(), "펼치기");
  }
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

/** 병합 버튼을 누르고, 마지막 병합 요청의 페이지를 카드 이름 형식으로 읽는다. */
async function mergeAndReadPages(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "병합", exact: true }).click();
  await expect(page.getByRole("button", { name: "다운로드" })).toBeVisible();
  const writes: E2eWriteCall[] = await page.evaluate(
    () => window.__E2E_MOCK_WRITES__ ?? []
  );
  const mergeCalls = writes.filter((call) => call.method === "mergePdfs");
  const mergeCall = mergeCalls[mergeCalls.length - 1];
  if (mergeCall?.method !== "mergePdfs") {
    throw new Error("병합 요청이 기록되지 않았습니다.");
  }
  const fileByPath = new Map(SEED_FILES.map((file) => [file.path, file]));
  return mergeCall.request.sources.flatMap((source) => {
    const file = fileByPath.get(source.path);
    if (!file) {
      throw new Error(`시드에 없는 경로입니다: ${source.path}`);
    }
    return source.pages.map((mergePage) => pageName(file, mergePage.index + 1));
  });
}

/** 병합 미리보기에서 저장하지 않고 작업 공간으로 돌아간다. */
async function backToWorkspace(page: Page): Promise<void> {
  await page.getByRole("button", { name: "작업 공간으로 돌아가기" }).click();
  await page.getByRole("button", { name: "돌아가기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "병합", exact: true })
  ).toBeVisible();
}

test("삭제한 페이지는 제자리에 남아 병합에서 빠지고, 카드·플로팅 바에서 복원하면 삭제 전과 같은 병합을 요청한다", async ({
  page
}) => {
  await page.addInitScript((files) => {
    window.__E2E_MOCK_SEED__ = { files };
  }, SEED_FILES);
  await page.goto("/");
  await page.getByRole("button", { name: "PDF 병합", exact: true }).click();
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(
    SEED_FILES.length
  );
  await expandAll(page);

  const alphaPage2 = pageName(FILE_A, 2);
  const bravoPage1 = pageName(FILE_B, 1);
  const originalOrder = await readCardOrder(page);
  expect(originalOrder).toEqual([
    pageName(FILE_A, 1),
    alphaPage2,
    pageName(FILE_A, 3),
    bravoPage1,
    pageName(FILE_B, 2),
    pageName(FILE_B, 3)
  ]);
  await expect(statusBar(page)).toContainText("전체 페이지: 6");

  // 삭제 전 병합 요청(기준)
  const requestBeforeDelete = await mergeAndReadPages(page);
  expect(requestBeforeDelete).toEqual(originalOrder);
  await backToWorkspace(page);

  // 페이지 2개 삭제 → 카드는 제자리에 "삭제됨"과 복원 버튼으로 남는다.
  for (const name of [alphaPage2, bravoPage1]) {
    await clickCardAction(sortableCard(page, name), "페이지 삭제");
    const card = sortableCard(page, name);
    await expect(card.getByText(DELETED_BADGE, { exact: true })).toBeVisible();
    await expect(
      card.getByRole("button", { name: "페이지 복원", exact: true })
    ).toBeVisible();
  }
  expect(await readCardOrder(page)).toEqual(originalOrder);
  // 상태바: 병합될 페이지 수 옆에 복원할 수 있는 삭제 수(시안 6)
  await expect(statusBar(page)).toContainText("전체 페이지: 4 (삭제 2)");

  // 접으면 쪽수와 남은 페이지 범위, 삭제가 있으면 "n쪽 삭제됨" 배지
  await clickCardAction(sortableCard(page, pageName(FILE_A, 1)), "접기");
  await clickCardAction(sortableCard(page, bravoPage1), "접기");
  const alphaDocument = sortableCard(page, `${FILE_A.displayName} 문서`);
  const bravoDocument = sortableCard(page, `${FILE_B.displayName} 문서`);
  await expect(alphaDocument).toContainText("2페이지 (1, 3)");
  await expect(alphaDocument).toContainText("1쪽 삭제됨");
  await expect(bravoDocument).toContainText("2페이지 (2-3)");
  await expect(bravoDocument).toContainText("1쪽 삭제됨");

  // B14: 삭제 상태로 병합하면 삭제 페이지가 요청에서 빠진다.
  expect(await mergeAndReadPages(page)).toEqual([
    pageName(FILE_A, 1),
    pageName(FILE_A, 3),
    pageName(FILE_B, 2),
    pageName(FILE_B, 3)
  ]);
  await backToWorkspace(page);
  await expandAll(page);

  // 하나는 카드의 복원 버튼으로
  await sortableCard(page, alphaPage2)
    .getByRole("button", { name: "페이지 복원", exact: true })
    .click();
  await expect(
    sortableCard(page, alphaPage2).getByText(DELETED_BADGE, { exact: true })
  ).toHaveCount(0);

  // 하나는 선택한 뒤 플로팅 바의 복원으로
  const bravoCard = sortableCard(page, bravoPage1);
  await bravoCard.hover();
  await bravoCard.getByRole("checkbox").click();
  await page
    .getByRole("button", { name: "선택 페이지 복원", exact: true })
    .click();
  await expect(page.getByText(DELETED_BADGE, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "선택 페이지 복원", exact: true })
  ).toHaveCount(0);

  // 원래 자리로 돌아오고, 병합 요청이 삭제 전과 같다.
  expect(await readCardOrder(page)).toEqual(originalOrder);
  await expect(statusBar(page)).toContainText("전체 페이지: 6");
  await expect(statusBar(page)).not.toContainText("삭제");
  expect(await mergeAndReadPages(page)).toEqual(requestBeforeDelete);
});
