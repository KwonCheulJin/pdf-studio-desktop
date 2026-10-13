import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed
} from "../src/renderer/app/providers/e2e-platform";
import type { PageInfo } from "../src/renderer/shared/api/bindings";
import type { NativeFileDropEvent } from "../src/renderer/shared/platform";

/**
 * 비교 파일 슬롯(계획서 P3-2, 진행 가이드 Step 25, 시안 3 위쪽).
 * - A(이전)·B(이후) 슬롯: 빈 상태(누르면 열기 다이얼로그) / 채운 상태(썸네일·이름·크기·쪽수·"준비됨"·"교체")
 * - 창 밖 드롭은 놓은 슬롯에(좌표 판정), 슬롯 밖이면 빈 슬롯을 A → B 순서로, 2개는 A·B 한 쌍으로
 * - A↔B 맞바꾸기, 모드를 오가도 세션과 읽은 문서가 남는다
 * - PDF가 아닌 파일·열 수 없는 파일·3개 이상은 알리고 슬롯을 그대로 둔다
 */

const FIXTURE_BYTES = readFileSync(
  path.join(__dirname, "fixtures", "three-pages.pdf")
).toString("base64");

/** WebView2(Windows)처럼 물리 픽셀 좌표를 주는 환경. mock 드롭은 이 값으로 나눈다. */
const DEVICE_PIXEL_RATIO = 2;
const VIEWPORT = { width: 1280, height: 800 };

test.use({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_PIXEL_RATIO });

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

interface SeedFileParams {
  displayName: string;
  pageCount: number;
  sizeBytes: number;
}

/** 썸네일은 같은 픽스처로 그리고, 쪽수·크기는 `openFiles` 결과로 다르게 준다. */
function seedFile({
  displayName,
  pageCount,
  sizeBytes
}: SeedFileParams): E2eMockFile {
  return {
    path: `/Users/e2e/originals/${displayName}`,
    displayName,
    pages: Array.from({ length: pageCount }, () => A4_PAGE),
    sizeBytes,
    bytesBase64: FIXTURE_BYTES
  };
}

// 크기는 1024 단위: 1,153,434 B = 1.1 MB, 1,258,291 B = 1.2 MB, 20,480 B = 20 KB
const FILE_V1 = seedFile({
  displayName: "contract-v1.pdf",
  pageCount: 18,
  sizeBytes: 1_153_434
});
const FILE_V2 = seedFile({
  displayName: "contract-v2.pdf",
  pageCount: 19,
  sizeBytes: 1_258_291
});
const FILE_V3 = seedFile({
  displayName: "contract-v3.pdf",
  pageCount: 4,
  sizeBytes: 20_480
});
/** 열 때 PDF로 바뀌는 TIFF(병합은 받지만 비교는 받지 않는다) */
const FILE_TIFF: E2eMockFile = {
  path: "/Users/e2e/originals/scan.tif",
  displayName: "scan.pdf",
  pages: [A4_PAGE],
  convertedPath: "/mock/converted/scan.pdf",
  bytesBase64: FIXTURE_BYTES
};
const FILE_LOCKED = seedFile({
  displayName: "locked.pdf",
  pageCount: 2,
  sizeBytes: 2_048
});

/** mock `fileStem`은 시드 표시 이름에서 확장자를 뺀다(알림 제목에 쓰인다). */
const TIFF_STEM = "scan";
const LOCKED_STEM = "locked";

const ALL_FILES = [FILE_V1, FILE_V2, FILE_V3, FILE_TIFF, FILE_LOCKED];

const BEFORE = "이전 문서";
const AFTER = "이후 문서";

async function openHome(
  page: Page,
  seed: Omit<E2eMockSeed, "files">
): Promise<void> {
  await page.addInitScript(
    (initialSeed) => {
      window.__E2E_MOCK_SEED__ = initialSeed;
    },
    { files: ALL_FILES, ...seed }
  );
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

function slot(page: Page, title: string): Locator {
  return page
    .getByRole("region", { name: "비교할 문서" })
    .getByRole("group", { name: title, exact: true });
}

function emptySlotButton(page: Page, title: string): Locator {
  return slot(page, title).getByRole("button", { name: /^PDF 고르기/ });
}

function swapButton(page: Page): Locator {
  return page.getByRole("button", { name: "A와 B 바꾸기" });
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

function toast(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

interface FilledSlotText {
  name: string;
  /** 크기 · 쪽수 */
  meta: string;
}

/** 채운 슬롯: 이름·크기·쪽수·"준비됨"·썸네일(첫 쪽 렌더) */
async function expectFilledSlot(
  page: Page,
  title: string,
  { name, meta }: FilledSlotText
): Promise<void> {
  const filled = slot(page, title);
  await expect(filled).toContainText(name);
  await expect(filled.getByText(meta, { exact: true })).toBeVisible();
  await expect(filled.getByText("준비됨", { exact: true })).toBeVisible();
  await expect(filled.getByRole("button", { name: "교체" })).toBeVisible();
  await expect(filled.locator("img")).toHaveAttribute("src", /^blob:/);
}

async function expectEmptySlot(page: Page, title: string): Promise<void> {
  await expect(emptySlotButton(page, title)).toBeVisible();
  await expect(slot(page, title).getByText("준비됨")).toHaveCount(0);
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

/** 요소 가운데에 놓는다. 좌표는 물리 픽셀(CSS 픽셀 × `devicePixelRatio`)로 보낸다. */
async function dropOn(
  page: Page,
  target: Locator,
  paths: string[]
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("놓을 곳이 화면에 없습니다.");
  }
  const position = {
    x: (box.x + box.width / 2) * DEVICE_PIXEL_RATIO,
    y: (box.y + box.height / 2) * DEVICE_PIXEL_RATIO
  };
  await dropFiles(page, { type: "enter", paths, position });
  await dropFiles(page, { type: "drop", paths, position });
}

/** 홈 비교 카드에 두 파일을 놓아 A·B를 채운 비교 화면으로 들어간다. */
async function openComparePair(
  page: Page,
  seed: Omit<E2eMockSeed, "files"> = {}
): Promise<void> {
  await openHome(page, seed);
  await dropOn(page, homeCard(page, "PDF 비교"), [FILE_V1.path, FILE_V2.path]);
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
}

/**
 * 두 슬롯이 빈 비교 화면. 홈에서는 비교에 파일을 넣어야 들어가므로 병합 카드로 들어간 뒤 탭으로 옮긴다.
 * 첫 열기 다이얼로그(병합 카드)는 `dialogPicks`의 첫 목록을 쓴다.
 */
async function openEmptyCompare(
  page: Page,
  dialogPicks: string[][]
): Promise<void> {
  await openHome(page, { dialogPicks: [[FILE_V3.path], ...dialogPicks] });
  await homeCard(page, "PDF 병합")
    .getByRole("button", { name: "파일 선택", exact: true })
    .click();
  await modeTab(page, "비교").click();
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
}

test("빈 슬롯을 누르면 다이얼로그로 고른 파일이 그 슬롯에 들어가고, 맞바꾸면 빈 자리와 함께 옮겨진다", async ({
  page
}) => {
  await openEmptyCompare(page, [[FILE_V1.path]]);

  await expectEmptySlot(page, BEFORE);
  await expectEmptySlot(page, AFTER);
  await expect(swapButton(page)).toBeDisabled();
  await expect(statusBar(page)).toContainText(/A 비어 있음\s*\|\s*B 비어 있음/);

  await emptySlotButton(page, BEFORE).click();

  await expectFilledSlot(page, BEFORE, {
    name: FILE_V1.displayName,
    meta: "1.1 MB · 18쪽"
  });
  await expectEmptySlot(page, AFTER);
  await expect(statusBar(page)).toContainText(/A 18쪽\s*\|\s*B 비어 있음/);

  await swapButton(page).click();

  await expectEmptySlot(page, BEFORE);
  await expectFilledSlot(page, AFTER, {
    name: FILE_V1.displayName,
    meta: "1.1 MB · 18쪽"
  });
  await expect(statusBar(page)).toContainText(/A 비어 있음\s*\|\s*B 18쪽/);
});

test("홈 비교 카드에 놓은 두 파일이 A·B로 들어가고, 맞바꾸면 슬롯과 상태바 쪽수가 바뀐다", async ({
  page
}) => {
  await openComparePair(page);

  await expectFilledSlot(page, BEFORE, {
    name: FILE_V1.displayName,
    meta: "1.1 MB · 18쪽"
  });
  await expectFilledSlot(page, AFTER, {
    name: FILE_V2.displayName,
    meta: "1.2 MB · 19쪽"
  });
  await expect(statusBar(page)).toContainText(/A 18쪽\s*\|\s*B 19쪽/);

  await swapButton(page).click();

  await expectFilledSlot(page, BEFORE, {
    name: FILE_V2.displayName,
    meta: "1.2 MB · 19쪽"
  });
  await expectFilledSlot(page, AFTER, {
    name: FILE_V1.displayName,
    meta: "1.1 MB · 18쪽"
  });
  await expect(statusBar(page)).toContainText(/A 19쪽\s*\|\s*B 18쪽/);
});

test("교체는 누른 슬롯만 다이얼로그로 고른 파일로 바꾼다", async ({ page }) => {
  await openComparePair(page, { dialogPicks: [[FILE_V3.path]] });

  await slot(page, AFTER).getByRole("button", { name: "교체" }).click();

  await expectFilledSlot(page, AFTER, {
    name: FILE_V3.displayName,
    meta: "20 KB · 4쪽"
  });
  await expectFilledSlot(page, BEFORE, {
    name: FILE_V1.displayName,
    meta: "1.1 MB · 18쪽"
  });
});

test("창 밖에서 끌어온 파일은 놓은 슬롯에 들어간다(좌표 판정, 물리 픽셀 보정)", async ({
  page
}) => {
  await openComparePair(page);

  await dropOn(page, slot(page, AFTER), [FILE_V3.path]);
  await expectFilledSlot(page, AFTER, {
    name: FILE_V3.displayName,
    meta: "20 KB · 4쪽"
  });
  await expect(slot(page, BEFORE)).toContainText(FILE_V1.displayName);

  await dropOn(page, slot(page, BEFORE), [FILE_V2.path]);
  await expectFilledSlot(page, BEFORE, {
    name: FILE_V2.displayName,
    meta: "1.2 MB · 19쪽"
  });
  await expect(slot(page, AFTER)).toContainText(FILE_V3.displayName);
});

test("슬롯 밖에 놓으면 빈 슬롯을 A → B 순서로 채우고, 둘 다 차 있으면 알리며, 두 파일은 A·B 한 쌍으로 넣는다", async ({
  page
}) => {
  await openEmptyCompare(page, []);
  const outside = page.getByRole("heading", { name: "새 비교" });

  await dropOn(page, outside, [FILE_V1.path]);
  await expect(slot(page, BEFORE)).toContainText(FILE_V1.displayName);
  await expectEmptySlot(page, AFTER);

  await dropOn(page, outside, [FILE_V2.path]);
  await expect(slot(page, AFTER)).toContainText(FILE_V2.displayName);

  await dropOn(page, outside, [FILE_V3.path]);
  await expect(toast(page, "두 슬롯이 모두 차 있어요.")).toBeVisible();
  await expect(slot(page, BEFORE)).toContainText(FILE_V1.displayName);
  await expect(slot(page, AFTER)).toContainText(FILE_V2.displayName);

  await dropOn(page, outside, [FILE_V3.path, FILE_V1.path]);
  await expect(slot(page, BEFORE)).toContainText(FILE_V3.displayName);
  await expect(slot(page, AFTER)).toContainText(FILE_V1.displayName);
});

test("모드를 오가도 슬롯이 그대로이고 슬롯 문서를 다시 읽지 않는다", async ({
  page
}) => {
  await openComparePair(page);
  await swapButton(page).click();
  await expect(slot(page, BEFORE).locator("img")).toHaveAttribute(
    "src",
    /^blob:/
  );
  await expect(slot(page, AFTER).locator("img")).toHaveAttribute(
    "src",
    /^blob:/
  );
  const readsBefore = await page.evaluate(
    () => window.__E2E_MOCK_READS__ ?? []
  );
  expect([...readsBefore].sort()).toEqual([FILE_V1.path, FILE_V2.path]);

  await modeTab(page, "병합").click();
  await expect(modeTab(page, "병합")).toHaveAttribute("aria-selected", "true");
  await modeTab(page, "비교").click();

  await expectFilledSlot(page, BEFORE, {
    name: FILE_V2.displayName,
    meta: "1.2 MB · 19쪽"
  });
  await expectFilledSlot(page, AFTER, {
    name: FILE_V1.displayName,
    meta: "1.1 MB · 18쪽"
  });
  expect(await page.evaluate(() => window.__E2E_MOCK_READS__ ?? [])).toEqual(
    readsBefore
  );
});

test("PDF가 아닌 파일·열 수 없는 파일·3개 이상은 알리고 슬롯을 그대로 둔다", async ({
  page
}) => {
  await openHome(page, {
    failures: { openFiles: { [FILE_LOCKED.path]: "PASSWORD_PROTECTED" } }
  });

  // 홈 비교 카드에 TIFF만 놓으면 넣은 것이 없어 홈에 남는다.
  await dropOn(page, homeCard(page, "PDF 비교"), [FILE_TIFF.path]);
  await expect(
    toast(page, `"${TIFF_STEM}" 파일은 비교할 수 없어요.`)
  ).toContainText("PDF만 비교할 수 있어요.");
  await expect(page.getByRole("tablist")).toHaveCount(0);

  await dropOn(page, homeCard(page, "PDF 비교"), [FILE_V1.path, FILE_V2.path]);
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();

  await dropOn(page, slot(page, BEFORE), [FILE_LOCKED.path]);
  await expect(
    toast(page, `"${LOCKED_STEM}" 파일을 열 수 없어요.`)
  ).toContainText("암호가 걸린 PDF라 열 수 없어요.");
  await expect(slot(page, BEFORE)).toContainText(FILE_V1.displayName);

  await dropOn(page, slot(page, AFTER), [
    FILE_V3.path,
    FILE_V1.path,
    FILE_V2.path
  ]);
  await expect(
    toast(page, "비교할 파일은 2개까지 넣을 수 있어요.")
  ).toBeVisible();
  await expect(slot(page, AFTER)).toContainText(FILE_V2.displayName);

  // 두 파일 중 받지 못한 파일의 자리(A)는 그대로 두고 나머지(B)만 바꾼다.
  await dropOn(page, slot(page, AFTER), [FILE_TIFF.path, FILE_V3.path]);
  await expect(slot(page, AFTER)).toContainText(FILE_V3.displayName);
  await expect(slot(page, BEFORE)).toContainText(FILE_V1.displayName);
});
