import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type { PageInfo } from "../src/renderer/shared/api/bindings";
import type { NativeFileDropEvent } from "../src/renderer/shared/platform";

/**
 * 앱 모드와 홈(계획서 P3-1, 진행 가이드 Step 24).
 * - 첫 화면은 홈이고 카드는 "PDF 병합"·"PDF 비교"·"PDF 번역" 세 장이다(번역은 translate-entry.spec.ts).
 * - 카드 버튼으로 고르거나 카드 위에 놓으면 그 모드로 들어간다(병합은 여러 개, 비교는 2개까지).
 * - 병합·비교 툴바 맨 왼쪽 `[병합 | 비교 | 번역]` 탭으로 바꿔도 각 모드의 상태가 남는다.
 * - 병합 결과 미리보기에 임시 결과가 있으면 비교로 넘어가기 전에 확인하고, 넘어가도 결과는 남는다.
 */

const FIXTURE_BYTES = readFileSync(
  path.join(__dirname, "fixtures", "three-pages.pdf")
).toString("base64");
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
    bytesBase64: FIXTURE_BYTES
  };
}

const FILE_A = seedFile("alpha.pdf");
const FILE_B = seedFile("bravo.pdf");
const FILE_C = seedFile("charlie.pdf");

const VIEWPORT = { width: 1280, height: 800 };

test.use({ viewport: VIEWPORT });

async function openHome(page: Page, files: E2eMockFile[]): Promise<void> {
  await page.addInitScript((seedFiles) => {
    window.__E2E_MOCK_SEED__ = { files: seedFiles };
  }, files);
  await page.goto("/");
}

function homeCard(page: Page, title: string): Locator {
  return page.getByRole("region", { name: title, exact: true });
}

function modeTab(page: Page, label: string): Locator {
  return page
    .getByRole("tablist", { name: "작업 모드" })
    .getByRole("tab", { name: label, exact: true });
}

function documentCards(page: Page): Locator {
  return page.getByTestId("document-card");
}

/** 비교 슬롯(시안 3): 이름은 슬롯 제목("이전 문서" | "이후 문서")이다. */
function compareSlot(page: Page, title: string): Locator {
  return page
    .getByRole("region", { name: "비교할 문서" })
    .getByRole("group", { name: title, exact: true });
}

async function expectCompareSlots(
  page: Page,
  [before, after]: [string, string]
): Promise<void> {
  await expect(compareSlot(page, "이전 문서")).toContainText(before);
  await expect(compareSlot(page, "이후 문서")).toContainText(after);
}

function selectionLabel(page: Page): Locator {
  return page.getByText(/^\d+개 (페이지|파일) 선택( \(삭제됨 \d+\))?$/);
}

function unsavedResultDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "저장하지 않은 병합 결과가 있어요" });
}

async function readWrites(page: Page): Promise<E2eWriteCall[]> {
  return page.evaluate(() => window.__E2E_MOCK_WRITES__ ?? []);
}

async function dropFiles(
  page: Page,
  event: NativeFileDropEvent
): Promise<void> {
  await page.evaluate((dropEvent) => {
    if (!window.__E2E_FILE_DROP__) {
      throw new Error("E2E 드롭 훅이 없습니다.");
    }
    window.__E2E_FILE_DROP__(dropEvent);
  }, event);
}

interface DropAtParams {
  paths: string[];
  /** CSS 픽셀 좌표 */
  x: number;
  y: number;
}

/** 창 밖에서 끌어와 (x, y)에 놓는다. 좌표는 물리 픽셀로 바꿔 보낸다. */
async function dropAt(
  page: Page,
  { paths, x, y }: DropAtParams
): Promise<void> {
  const pixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const position = { x: x * pixelRatio, y: y * pixelRatio };
  await dropFiles(page, { type: "enter", paths, position });
  await dropFiles(page, { type: "drop", paths, position });
}

/** 요소 가운데에 놓는다. */
async function dropOn(
  page: Page,
  target: Locator,
  paths: string[]
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("놓을 곳이 화면에 없습니다.");
  }
  await dropAt(page, {
    paths,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  });
}

test("첫 화면은 홈이고 병합·비교·번역 카드 세 장이 있다", async ({ page }) => {
  await openHome(page, [FILE_A]);

  await expect(
    page.getByRole("heading", { name: "어떤 작업을 할까요?" })
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("region")).toHaveCount(3);
  await expect(
    homeCard(page, "PDF 병합").getByRole("button", {
      name: "파일 선택",
      exact: true
    })
  ).toBeVisible();
  await expect(
    homeCard(page, "PDF 비교").getByRole("button", {
      name: "두 파일 선택",
      exact: true
    })
  ).toBeVisible();
  await expect(
    homeCard(page, "PDF 번역").getByRole("button", {
      name: "번역할 파일 선택",
      exact: true
    })
  ).toBeVisible();
  await expect(
    page.getByText(
      "원본 파일은 바뀌지 않아요. 결과는 저장할 곳을 골라 새 파일로 만들어요."
    )
  ).toBeVisible();
  // 모드 탭은 병합·비교 화면에만 있다.
  await expect(page.getByRole("tablist")).toHaveCount(0);
});

test("병합 카드 버튼으로 파일을 고르면 병합 모드로 들어가고 툴바에 병합 탭이 골라져 있다", async ({
  page
}) => {
  await openHome(page, [FILE_A, FILE_B]);

  await homeCard(page, "PDF 병합")
    .getByRole("button", { name: "파일 선택", exact: true })
    .click();

  await expect(documentCards(page)).toHaveCount(2);
  await expect(modeTab(page, "병합")).toHaveAttribute("aria-selected", "true");
  await expect(modeTab(page, "비교")).toHaveAttribute("aria-selected", "false");
});

test("비교 카드 버튼으로 두 파일을 고르면 A·B에 넣고 비교 모드로 들어간다", async ({
  page
}) => {
  await openHome(page, [FILE_A, FILE_B]);

  await homeCard(page, "PDF 비교")
    .getByRole("button", { name: "두 파일 선택", exact: true })
    .click();

  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
  await expect(modeTab(page, "비교")).toHaveAttribute("aria-selected", "true");
  await expectCompareSlots(page, [FILE_A.displayName, FILE_B.displayName]);
});

test("비교 카드에는 2개까지 놓을 수 있고, 카드 밖이나 3개 이상이면 홈에 남는다", async ({
  page
}) => {
  await openHome(page, [FILE_A, FILE_B, FILE_C]);
  const compareCard = homeCard(page, "PDF 비교");

  // 카드 밖(제목)에 놓으면 아무 작업에도 넣지 않는다.
  await dropOn(
    page,
    page.getByRole("heading", { name: "어떤 작업을 할까요?" }),
    [FILE_A.path, FILE_B.path]
  );
  // 3개는 어느 둘을 비교할지 알 수 없어 넣지 않고 알린다.
  await dropOn(page, compareCard, [FILE_A.path, FILE_B.path, FILE_C.path]);
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "비교할 파일은 2개까지 넣을 수 있어요." })
  ).toBeVisible();
  await expect(compareCard).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);

  await dropOn(page, compareCard, [FILE_A.path, FILE_B.path]);

  await expect(modeTab(page, "비교")).toHaveAttribute("aria-selected", "true");
  await expectCompareSlots(page, [FILE_A.displayName, FILE_B.displayName]);
});

test("모드 탭으로 오가도 병합 파일·선택과 비교 세션이 그대로 남는다", async ({
  page
}) => {
  await openHome(page, [FILE_A, FILE_B, FILE_C]);

  // 비교 카드에 두 파일 → 비교 모드
  await dropOn(page, homeCard(page, "PDF 비교"), [FILE_A.path, FILE_B.path]);
  await expectCompareSlots(page, [FILE_A.displayName, FILE_B.displayName]);

  // 병합 탭: 파일이 없어도 탭이 있는 빈 작업 공간이다.
  await modeTab(page, "병합").click();
  await expect(modeTab(page, "병합")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await expect(documentCards(page)).toHaveCount(3);
  await page
    .getByRole("button", { name: "bravo.pdf 문서", exact: true })
    .click();
  await expect(selectionLabel(page)).toHaveText("1개 파일 선택");

  // 임시 결과가 없으면 확인 없이 넘어가고, 비교 세션은 남아 있다.
  await modeTab(page, "비교").click();
  await expect(unsavedResultDialog(page)).toHaveCount(0);
  await expectCompareSlots(page, [FILE_A.displayName, FILE_B.displayName]);

  await modeTab(page, "병합").click();
  await expect(documentCards(page)).toHaveCount(3);
  await expect(page.locator("footer")).toContainText("전체 파일: 3");
  await expect(selectionLabel(page)).toHaveText("1개 파일 선택");
});

test("전체 삭제한 빈 병합 화면에도 모드 탭이 있고 놓은 파일을 받는다", async ({
  page
}) => {
  await openHome(page, [FILE_A]);
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await expect(documentCards(page)).toHaveCount(1);

  await page.getByRole("button", { name: "전체 삭제" }).click();
  await expect(documentCards(page)).toHaveCount(0);
  await expect(modeTab(page, "병합")).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("PDF 또는 TIFF 파일을 드래그 앤 드롭하세요")
  ).toBeVisible();

  await dropAt(page, {
    paths: [FILE_A.path],
    x: VIEWPORT.width / 2,
    y: VIEWPORT.height / 2
  });
  await expect(documentCards(page)).toHaveCount(1);
});

test("병합 결과 미리보기에 임시 결과가 있으면 비교로 넘어가기 전에 확인하고, 넘어가도 결과는 남는다", async ({
  page
}) => {
  await openHome(page, [FILE_A, FILE_B]);
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await expect(documentCards(page)).toHaveCount(2);
  await page.getByRole("button", { name: "병합", exact: true }).click();
  const downloadButton = page.getByRole("button", { name: "다운로드" });
  await expect(downloadButton).toBeVisible();

  // 취소하면 미리보기에 그대로 있다.
  await modeTab(page, "비교").click();
  await expect(unsavedResultDialog(page)).toBeVisible();
  await unsavedResultDialog(page).getByRole("button", { name: "취소" }).click();
  await expect(unsavedResultDialog(page)).toBeHidden();
  await expect(downloadButton).toBeVisible();
  await expect(modeTab(page, "병합")).toHaveAttribute("aria-selected", "true");

  // 넘어가도 임시 결과는 지우지 않아 병합 탭으로 돌아오면 그대로 보인다.
  await modeTab(page, "비교").click();
  await unsavedResultDialog(page)
    .getByRole("button", { name: "비교로 이동" })
    .click();
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
  await modeTab(page, "병합").click();
  await expect(downloadButton).toBeVisible();
  expect(
    (await readWrites(page)).filter((call) => call.method === "discardTemp")
  ).toEqual([]);
});
