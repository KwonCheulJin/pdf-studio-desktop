import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { E2eMockFile } from "../src/renderer/app/providers/e2e-platform";
import type { PageInfo } from "../src/renderer/shared/api/bindings";

/**
 * 카드 선택(계획서 P0-6 B11)과 키보드·접근성(A1 나머지).
 * - 카드 본문 클릭 = 단일 선택, ⌘+클릭 = 추가·해제, Shift+클릭 = 기준점부터 범위
 * - 어떤 경로로든 지운 카드는 선택에서 빠진다
 * - Delete 선택 삭제, ⌘A 전체 선택, Esc 선택 해제(카드를 집었거나 모달이 열리면 가로채지 않는다)
 * 시드의 userAgent가 macOS(Desktop Safari)라 주 보조키는 ⌘(Meta)다.
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
const FILE_C = seedFile("charlie.pdf");
const SEED_FILES = [FILE_A, FILE_B, FILE_C];

const DELETED_BADGE = "삭제됨";

// 기본 카드 크기로 한 행에 카드 6장, 9장이 두 행에 다 보이는 크기
test.use({ viewport: { width: 1800, height: 1000 } });

function pageName(file: E2eMockFile, pageNumber: number): string {
  return `${file.displayName} ${pageNumber}쪽`;
}

function documentName(file: E2eMockFile): string {
  return `${file.displayName} 문서`;
}

/** 정렬 카드(카드 본문). 이름은 스크린 리더가 읽는 카드 이름 */
function sortableCard(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

function pageCheckbox(
  page: Page,
  file: E2eMockFile,
  pageNumber: number
): Locator {
  return page.getByRole("checkbox", {
    name: `${pageName(file, pageNumber)} 선택`,
    exact: true
  });
}

function documentCheckbox(page: Page, file: E2eMockFile): Locator {
  return page.getByRole("checkbox", {
    name: `${file.displayName} 선택`,
    exact: true
  });
}

/** 플로팅 바의 선택 수 문구 */
function selectionLabel(page: Page): Locator {
  return page.getByText(/^\d+개 (페이지|파일) 선택됨$/);
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

/** dnd-kit live region */
function announcer(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: "카드" });
}

async function openWorkspace(page: Page): Promise<void> {
  await page.addInitScript((files) => {
    window.__E2E_MOCK_SEED__ = { files };
  }, SEED_FILES);
  await page.goto("/");
  await page.getByRole("button", { name: "파일 선택" }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(
    SEED_FILES.length
  );
}

async function expandAll(page: Page): Promise<void> {
  const documentCards = page.getByTestId("document-card");
  while ((await documentCards.count()) > 0) {
    const card = documentCards.first();
    await card.hover();
    await card.getByRole("button", { name: "펼치기", exact: true }).click();
  }
}

/** 체크박스 상태로 읽은 선택된 페이지 카드 이름(화면 순서) */
async function readCheckedPages(page: Page): Promise<string[]> {
  const names: string[] = [];
  for (const file of SEED_FILES) {
    for (let number = 1; number <= FIXTURE_PAGE_COUNT; number++) {
      const state = await pageCheckbox(page, file, number).getAttribute(
        "aria-checked"
      );
      if (state === "true") names.push(pageName(file, number));
    }
  }
  return names;
}

test("클릭은 단일, ⌘+클릭은 추가·해제, Shift+클릭은 기준점부터 범위로 페이지를 고르고 Delete로 지우면 선택이 빈다", async ({
  page
}) => {
  await openWorkspace(page);
  await expandAll(page);

  // 클릭 = 단일 선택(앞 선택을 바꾼다)
  await sortableCard(page, pageName(FILE_A, 1)).click();
  await expect(selectionLabel(page)).toHaveText("1개 페이지 선택됨");
  await sortableCard(page, pageName(FILE_A, 2)).click();
  await expect(selectionLabel(page)).toHaveText("1개 페이지 선택됨");
  expect(await readCheckedPages(page)).toEqual([pageName(FILE_A, 2)]);

  // Shift+클릭 = 기준점(alpha 2쪽)부터 범위
  await sortableCard(page, pageName(FILE_B, 2)).click({
    modifiers: ["Shift"]
  });
  await expect(selectionLabel(page)).toHaveText("4개 페이지 선택됨");
  expect(await readCheckedPages(page)).toEqual([
    pageName(FILE_A, 2),
    pageName(FILE_A, 3),
    pageName(FILE_B, 1),
    pageName(FILE_B, 2)
  ]);

  // 기준점은 그대로라 다시 Shift+클릭하면 범위를 새로 잡는다
  await sortableCard(page, pageName(FILE_A, 3)).click({
    modifiers: ["Shift"]
  });
  await expect(selectionLabel(page)).toHaveText("2개 페이지 선택됨");
  expect(await readCheckedPages(page)).toEqual([
    pageName(FILE_A, 2),
    pageName(FILE_A, 3)
  ]);

  // ⌘+클릭 = 추가, 한 번 더 = 해제
  await sortableCard(page, pageName(FILE_C, 1)).click({
    modifiers: ["Meta"]
  });
  await sortableCard(page, pageName(FILE_C, 3)).click({
    modifiers: ["Meta"]
  });
  await expect(selectionLabel(page)).toHaveText("4개 페이지 선택됨");
  await sortableCard(page, pageName(FILE_C, 1)).click({
    modifiers: ["Meta"]
  });
  expect(await readCheckedPages(page)).toEqual([
    pageName(FILE_A, 2),
    pageName(FILE_A, 3),
    pageName(FILE_C, 3)
  ]);

  // Delete = 선택 삭제. 지운 카드는 제자리에 "삭제됨"으로 남고 선택은 빈다.
  await page.keyboard.press("Delete");
  await expect(selectionLabel(page)).toHaveCount(0);
  for (const name of [
    pageName(FILE_A, 2),
    pageName(FILE_A, 3),
    pageName(FILE_C, 3)
  ]) {
    await expect(
      sortableCard(page, name).getByText(DELETED_BADGE, { exact: true })
    ).toBeVisible();
  }
  await expect(statusBar(page)).toContainText("전체 페이지: 6");
  expect(await readCheckedPages(page)).toEqual([]);
});

test("카드 버튼으로 지운 페이지·파일은 선택에서 빠지고, 복원 버튼은 지운 카드를 다시 고를 때만 보인다", async ({
  page
}) => {
  await openWorkspace(page);

  // 파일: 문서 카드 둘을 고른 뒤 하나를 카드 버튼으로 지운다
  await sortableCard(page, documentName(FILE_A)).click();
  await sortableCard(page, documentName(FILE_B)).click({
    modifiers: ["Meta"]
  });
  await expect(documentCheckbox(page, FILE_A)).toBeChecked();
  await expect(documentCheckbox(page, FILE_B)).toBeChecked();
  const alphaDocument = sortableCard(page, documentName(FILE_A));
  await alphaDocument.hover();
  await alphaDocument
    .getByRole("button", { name: "파일 삭제", exact: true })
    .click();
  await expect(page.getByTestId("document-card")).toHaveCount(2);
  await expect(documentCheckbox(page, FILE_B)).toBeChecked();
  // 남은 bravo를 풀면 선택이 빈다(지운 alpha의 ID가 선택에 남아 있지 않다)
  await sortableCard(page, documentName(FILE_B)).click({
    modifiers: ["Meta"]
  });
  await expect(selectionLabel(page)).toHaveCount(0);

  // 페이지: 둘을 고른 뒤 하나를 카드 버튼으로 지운다
  await expandAll(page);
  const bravoPage1 = sortableCard(page, pageName(FILE_B, 1));
  await bravoPage1.click();
  await sortableCard(page, pageName(FILE_B, 2)).click({
    modifiers: ["Meta"]
  });
  await expect(selectionLabel(page)).toHaveText("2개 페이지 선택됨");
  await bravoPage1.hover();
  await bravoPage1
    .getByRole("button", { name: "페이지 삭제", exact: true })
    .click();
  await expect(
    bravoPage1.getByText(DELETED_BADGE, { exact: true })
  ).toBeVisible();
  await expect(selectionLabel(page)).toHaveText("1개 페이지 선택됨");
  await expect(pageCheckbox(page, FILE_B, 1)).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "선택 페이지 복원", exact: true })
  ).toHaveCount(0);

  // 지운 카드를 다시 고르면 플로팅 바에 복원 버튼이 나온다
  await pageCheckbox(page, FILE_B, 1).click();
  await expect(
    page.getByRole("button", { name: "선택 페이지 복원", exact: true })
  ).toBeVisible();
});

test("⌘A는 전체 선택, Esc는 선택 해제이고, 카드를 집었거나 모달이 열린 동안에는 가로채지 않는다", async ({
  page
}) => {
  await openWorkspace(page);

  // ⌘A: 모든 문서 카드와 툴바의 전체 선택 체크박스가 켜진다
  await page.keyboard.press("Meta+a");
  for (const file of SEED_FILES) {
    await expect(documentCheckbox(page, file)).toBeChecked();
  }
  await expect(
    page.getByRole("checkbox", { name: "전체 선택", exact: true })
  ).toBeChecked();

  // Esc: 선택 해제
  await page.keyboard.press("Escape");
  await expect(selectionLabel(page)).toHaveCount(0);
  for (const file of SEED_FILES) {
    await expect(documentCheckbox(page, file)).not.toBeChecked();
  }

  // 툴바 전체 선택은 진짜 체크박스: 눌러서 켜고 끈다
  const selectAll = page.getByRole("checkbox", {
    name: "전체 선택",
    exact: true
  });
  await selectAll.click();
  await expect(documentCheckbox(page, FILE_C)).toBeChecked();
  await selectAll.click();
  await expect(documentCheckbox(page, FILE_C)).not.toBeChecked();

  await expandAll(page);
  await sortableCard(page, pageName(FILE_A, 1)).click();
  await expect(selectionLabel(page)).toHaveText("1개 페이지 선택됨");

  // 카드를 집은 동안: Delete는 지우지 않고, Esc는 집기만 취소한다
  const bravoPage1 = pageName(FILE_B, 1);
  await sortableCard(page, bravoPage1).focus();
  await page.keyboard.press("Space");
  await expect(announcer(page)).toContainText(bravoPage1);
  await page.keyboard.press("Delete");
  await page.keyboard.press("Escape");
  await expect(announcer(page)).toContainText("이동을 취소했습니다.");
  await expect(selectionLabel(page)).toHaveText("1개 페이지 선택됨");
  await expect(page.getByText(DELETED_BADGE, { exact: true })).toHaveCount(0);

  // 모달이 열린 동안: Delete는 지우지 않고, Esc는 모달만 닫는다
  const alphaPage1 = sortableCard(page, pageName(FILE_A, 1));
  await alphaPage1.hover();
  await alphaPage1
    .getByRole("button", { name: "미리보기", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(selectionLabel(page)).toHaveText("1개 페이지 선택됨");
  await expect(page.getByText(DELETED_BADGE, { exact: true })).toHaveCount(0);

  // 그다음 Esc는 선택을 푼다
  await page.keyboard.press("Escape");
  await expect(selectionLabel(page)).toHaveCount(0);
});

test("키보드 포커스가 카드에 있으면 카드 버튼이 보인다", async ({ page }) => {
  await openWorkspace(page);
  await expandAll(page);
  // 마우스는 카드 밖으로(hover로 보이는 것과 구분한다)
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  const card = sortableCard(page, pageName(FILE_C, 2));
  // Tooltip이 버튼에 붙으므로 버튼의 부모가 카드 버튼 묶음이다
  const actions = card
    .getByRole("button", { name: "페이지 삭제", exact: true })
    .locator("xpath=..");
  const checkboxFrame = pageCheckbox(page, FILE_C, 2).locator("xpath=..");
  await expect(actions).toHaveCSS("opacity", "0");
  await expect(checkboxFrame).toHaveCSS("opacity", "0");

  await card.focus();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(actions).toHaveCSS("pointer-events", "auto");
  await expect(checkboxFrame).toHaveCSS("opacity", "1");
  await expect(
    card.getByRole("button", { name: "페이지 삭제", exact: true })
  ).toBeVisible();

  // 카드 안 버튼으로 포커스가 옮겨가도 계속 보인다
  await card
    .getByRole("button", { name: "시계 방향 회전", exact: true })
    .focus();
  await expect(actions).toHaveCSS("opacity", "1");
});

test("병합 진행 오버레이는 role=status live region이다", async ({ page }) => {
  await openWorkspace(page);
  await page.evaluate(() => {
    window.__E2E_HOLD_MERGE__ = new Promise<void>((resolve) => {
      window.__E2E_RELEASE_MERGE__ = resolve;
    });
  });

  await page.getByRole("button", { name: "병합", exact: true }).click();
  const progress = page.getByRole("status").filter({ hasText: "PDF 병합 중" });
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("aria-live", "polite");

  await page.evaluate(() => window.__E2E_RELEASE_MERGE__?.());
  await expect(progress).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다운로드" })).toBeVisible();
});

test("파일 모드 선택 수는 고른 파일 수이고 '병합하기'도 파일이 둘 이상일 때만 보인다", async ({
  page
}) => {
  await openWorkspace(page);
  const mergeSelected = page.getByRole("button", {
    name: "선택 파일 병합",
    exact: true
  });

  await sortableCard(page, documentName(FILE_A)).click();
  await expect(selectionLabel(page)).toHaveText("1개 파일 선택됨");
  await expect(mergeSelected).toHaveCount(0);

  await sortableCard(page, documentName(FILE_B)).click({
    modifiers: ["Meta"]
  });
  await expect(selectionLabel(page)).toHaveText("2개 파일 선택됨");
  await expect(mergeSelected).toBeVisible();

  await page.keyboard.press("Meta+a");
  await expect(selectionLabel(page)).toHaveText("3개 파일 선택됨");
});

test("카드를 집은 채로 전체 삭제해도 파일을 다시 넣으면 선택 단축키가 동작한다", async ({
  page
}) => {
  await openWorkspace(page);
  const alpha = documentName(FILE_A);
  await sortableCard(page, alpha).focus();
  await page.keyboard.press("Space");
  await expect(announcer(page)).toContainText(alpha);

  // 집은 채로 마우스로 전체 삭제 → 그리드가 사라진다(dnd-kit은 끝 이벤트를 보내지 않는다)
  await page.getByRole("button", { name: "전체 삭제" }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(0);

  await page.getByRole("button", { name: "파일 선택" }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(
    SEED_FILES.length
  );
  await page.keyboard.press("Meta+a");
  await expect(selectionLabel(page)).toHaveText(
    `${SEED_FILES.length}개 파일 선택됨`
  );
});
