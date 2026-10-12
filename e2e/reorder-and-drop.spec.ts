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
 * 카드 재정렬(dnd-kit, 계획서 P0-5)과 창 밖 파일 드롭(`platform.onFileDrop`, P1-4).
 * 화면에 보이는 순서가 아니라 mock 플랫폼에 기록된 병합 요청으로 순서를 확인한다.
 */

const FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");
const FIXTURE_NAME = "three-pages.pdf";
const FIXTURE_PAGE_COUNT = 3;

/** WebView2(Windows)처럼 물리 픽셀 좌표를 주는 환경. mock 드롭은 이 값으로 나눈다. */
const DEVICE_PIXEL_RATIO = 2;

/**
 * dnd-kit 포인터 센서는 드래그 중 document에 click 차단 리스너(capture)를 걸고,
 * 놓은 뒤 50ms가 지나야 뗀다(`AbstractPointerSensor.detach`). 그 안에 누른 버튼은 눌리지 않는다.
 */
const POINTER_CLICK_BLOCK_RELEASE_MS = 100;

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

/** 같은 픽스처를 다른 경로·이름으로 연다(썸네일 내용은 같고 이름으로 구분한다). */
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

// 기본 카드 크기(240px)로 한 행에 카드 6장이 들어가는 너비. 키보드 정렬은 그리드라서
// 행 끝에서 오른쪽 방향키를 눌러도 다음 행으로 넘어가지 않는다(아래 방향키로 간다).
test.use({
  viewport: { width: 1800, height: 1000 },
  deviceScaleFactor: DEVICE_PIXEL_RATIO
});

async function openWorkspace(page: Page, files: E2eMockFile[]): Promise<void> {
  await page.addInitScript((seedFiles) => {
    window.__E2E_MOCK_SEED__ = { files: seedFiles };
  }, files);
  await page.goto("/");
}

async function pickAllFiles(page: Page, files: E2eMockFile[]): Promise<void> {
  await page.getByRole("button", { name: "파일 선택" }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(files.length);
}

/** 정렬 카드(키보드 포커스·포인터 드래그 대상). 이름은 스크린 리더가 읽는 카드 이름 */
function sortableCard(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

function documentName(file: E2eMockFile): string {
  return `${file.displayName} 문서`;
}

function pageName(file: E2eMockFile, pageNumber: number): string {
  return `${file.displayName} ${pageNumber}쪽`;
}

/** 정렬 카드 이름을 화면 순서(= 병합 순서)대로 읽는다. */
async function readCardOrder(page: Page): Promise<string[]> {
  return page
    .locator("[aria-roledescription]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label") ?? "")
    );
}

/** dnd-kit live region. 카드를 집고 옮기고 놓을 때마다 문구가 바뀐다. */
function announcer(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: "카드" });
}

/** 펼치기 버튼은 마우스를 올렸을 때만 눌린다. */
async function expandAll(page: Page): Promise<void> {
  const documentCards = page.getByTestId("document-card");
  while ((await documentCards.count()) > 0) {
    const card = documentCards.first();
    await card.hover();
    await card.getByRole("button", { name: "펼치기", exact: true }).click();
  }
}

const ARROW_STEP = { ArrowLeft: -1, ArrowRight: 1 } as const;

type ArrowKey = keyof typeof ARROW_STEP;

interface KeyboardMoveParams {
  name: string;
  key: ArrowKey;
  times: number;
}

/**
 * 카드에 포커스를 두고 Space로 집은 뒤 방향키를 누른다. 누를 때마다 dnd-kit이 알리는
 * 자리(live region)를 기다린다. 집으면 "집었습니다"에 이어 지금 자리를 바로 알린다.
 * 돌려주는 값은 마지막으로 알린 자리(1부터)와 전체 카드 수
 */
async function pickAndStep(
  page: Page,
  { name, key, times }: KeyboardMoveParams
): Promise<string> {
  const order = await readCardOrder(page);
  let position = order.indexOf(name) + 1;
  const where = () => `위치 ${position} / ${order.length}`;
  await sortableCard(page, name).focus();
  await page.keyboard.press("Space");
  await expect(announcer(page)).toHaveText(
    `${name} 카드가 ${where()}에 있습니다.`
  );
  for (let count = 0; count < times; count++) {
    await page.keyboard.press(key);
    position += ARROW_STEP[key];
    await expect(announcer(page)).toHaveText(
      `${name} 카드가 ${where()}에 있습니다.`
    );
  }
  return where();
}

/** Space로 집고 방향키로 옮긴 뒤 Space로 놓는다. */
async function moveWithKeyboard(
  page: Page,
  params: KeyboardMoveParams
): Promise<void> {
  const where = await pickAndStep(page, params);
  await page.keyboard.press("Space");
  await expect(announcer(page)).toHaveText(
    `${params.name} 카드를 ${where}에 놓았습니다.`
  );
}

interface RequestedSegment {
  fileName: string;
  /** 원본 쪽 번호(1부터) */
  pageNumbers: number[];
}

/** 병합 버튼을 누르고, 기록된 병합 요청의 구간을 파일 이름과 쪽 번호로 읽는다. */
async function mergeAndReadSegments(
  page: Page,
  files: E2eMockFile[]
): Promise<RequestedSegment[]> {
  await page.getByRole("button", { name: "병합", exact: true }).click();
  await expect(page.getByRole("button", { name: "다운로드" })).toBeVisible();
  const writes: E2eWriteCall[] = await page.evaluate(
    () => window.__E2E_MOCK_WRITES__ ?? []
  );
  const mergeCall = writes.find((call) => call.method === "mergePdfs");
  if (mergeCall?.method !== "mergePdfs") {
    throw new Error("병합 요청이 기록되지 않았습니다.");
  }
  const nameByPath = new Map(
    files.map((file) => [file.path, file.displayName])
  );
  return mergeCall.request.sources.map((source) => ({
    fileName: nameByPath.get(source.path) ?? source.path,
    pageNumbers: source.pages.map((mergePage) => mergePage.index + 1)
  }));
}

function wholeFile(file: E2eMockFile): RequestedSegment {
  return {
    fileName: file.displayName,
    pageNumbers: Array.from(
      { length: FIXTURE_PAGE_COUNT },
      (_, index) => index + 1
    )
  };
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 카드는 자리를 옮길 때 CSS transition으로 움직인다. 좌표를 읽기 전에 다 끝나기를 기다린다. */
async function waitForCardsToSettle(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => !(animation instanceof CSSTransition))
  );
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("요소가 화면에 없습니다.");
  }
  return box;
}

test("키보드만으로 파일과 페이지 순서를 바꾸면 섞인 순서 그대로 병합을 요청하고, Esc는 순서를 바꾸지 않는다", async ({
  page
}) => {
  const files = [FILE_A, FILE_B];
  await openWorkspace(page, files);
  await pickAllFiles(page, files);

  // 파일 카드: alpha를 오른쪽으로 한 칸 → bravo, alpha
  await moveWithKeyboard(page, {
    name: documentName(FILE_A),
    key: "ArrowRight",
    times: 1
  });
  expect(await readCardOrder(page)).toEqual([
    documentName(FILE_B),
    documentName(FILE_A)
  ]);

  await expandAll(page);
  expect(await readCardOrder(page)).toEqual([
    pageName(FILE_B, 1),
    pageName(FILE_B, 2),
    pageName(FILE_B, 3),
    pageName(FILE_A, 1),
    pageName(FILE_A, 2),
    pageName(FILE_A, 3)
  ]);

  // Esc: 집고 옮기다 취소하면 순서가 그대로다.
  const name = pageName(FILE_B, 1);
  await pickAndStep(page, { name, key: "ArrowRight", times: 2 });
  await page.keyboard.press("Escape");
  await expect(announcer(page)).toHaveText(
    `이동을 취소했습니다. ${name} 카드는 원래 자리에 있습니다.`
  );
  expect(await readCardOrder(page)).toEqual([
    pageName(FILE_B, 1),
    pageName(FILE_B, 2),
    pageName(FILE_B, 3),
    pageName(FILE_A, 1),
    pageName(FILE_A, 2),
    pageName(FILE_A, 3)
  ]);

  // bravo 3쪽을 맨 끝으로 → 파일이 섞인다(bravo, alpha, bravo).
  await moveWithKeyboard(page, {
    name: pageName(FILE_B, 3),
    key: "ArrowRight",
    times: 3
  });
  // alpha 3쪽을 alpha 1쪽 앞으로 → 파일 안 순서가 바뀐다.
  await moveWithKeyboard(page, {
    name: pageName(FILE_A, 3),
    key: "ArrowLeft",
    times: 2
  });
  expect(await readCardOrder(page)).toEqual([
    pageName(FILE_B, 1),
    pageName(FILE_B, 2),
    pageName(FILE_A, 3),
    pageName(FILE_A, 1),
    pageName(FILE_A, 2),
    pageName(FILE_B, 3)
  ]);

  expect(await mergeAndReadSegments(page, files)).toEqual([
    { fileName: FILE_B.displayName, pageNumbers: [1, 2] },
    { fileName: FILE_A.displayName, pageNumbers: [3, 1, 2] },
    { fileName: FILE_B.displayName, pageNumbers: [3] }
  ]);
});

test("포인터로 파일 카드를 끌어 놓으면 순서가 바뀐다", async ({ page }) => {
  const files = [FILE_A, FILE_B, FILE_C];
  await openWorkspace(page, files);
  await pickAllFiles(page, files);
  await waitForCardsToSettle(page);

  // alpha를 charlie 자리로 끌어 놓는다 → bravo, charlie, alpha
  const from = await boxOf(sortableCard(page, documentName(FILE_A)));
  const to = await boxOf(sortableCard(page, documentName(FILE_C)));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 20
  });
  await expect(announcer(page)).toHaveText(
    `${documentName(FILE_A)} 카드가 위치 3 / 3에 있습니다.`
  );
  await page.mouse.up();
  await expect(announcer(page)).toHaveText(
    `${documentName(FILE_A)} 카드를 위치 3 / 3에 놓았습니다.`
  );
  // 놓은 직후 클릭 차단이 풀릴 때까지 기다린 뒤 병합 버튼을 누른다.
  await page.waitForTimeout(POINTER_CLICK_BLOCK_RELEASE_MS);

  expect(await readCardOrder(page)).toEqual([
    documentName(FILE_B),
    documentName(FILE_C),
    documentName(FILE_A)
  ]);
  expect(await mergeAndReadSegments(page, files)).toEqual([
    wholeFile(FILE_B),
    wholeFile(FILE_C),
    wholeFile(FILE_A)
  ]);
});

test("창 밖에서 끌어온 파일은 놓은 자리(물리 픽셀 → CSS 픽셀)에 들어간다", async ({
  page
}) => {
  const files = [FILE_A, FILE_B, FILE_C];
  await openWorkspace(page, files);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    DEVICE_PIXEL_RATIO
  );
  const toPhysical = (x: number, y: number) => ({
    x: x * DEVICE_PIXEL_RATIO,
    y: y * DEVICE_PIXEL_RATIO
  });

  // 빈 작업 공간: 끌어오면 안내가 보이고, 놓으면 놓은 순서대로 추가된다.
  const center = toPhysical(800, 500);
  await dropFiles(page, {
    type: "enter",
    paths: [FILE_A.path, FILE_B.path],
    position: center
  });
  await expect(page.getByText("여기에 파일을 놓으세요")).toBeVisible();
  await dropFiles(page, {
    type: "drop",
    paths: [FILE_A.path, FILE_B.path],
    position: center
  });
  await expect(page.getByText("여기에 파일을 놓으세요")).toBeHidden();
  await expect(page.getByTestId("document-card")).toHaveCount(2);
  expect(await readCardOrder(page)).toEqual([
    documentName(FILE_A),
    documentName(FILE_B)
  ]);

  // 두 카드 사이 간격 위로 끌어오면 그 자리에 드롭 표시가 보인다.
  await waitForCardsToSettle(page);
  const alpha = await boxOf(sortableCard(page, documentName(FILE_A)));
  const bravo = await boxOf(sortableCard(page, documentName(FILE_B)));
  const gapX = (alpha.x + alpha.width + bravo.x) / 2;
  const gapY = alpha.y + alpha.height / 2;
  const between = toPhysical(gapX, gapY);
  await dropFiles(page, {
    type: "enter",
    paths: [FILE_C.path],
    position: between
  });
  await dropFiles(page, { type: "over", position: between });
  const indicator = page.getByTestId("drop-indicator");
  await expect(indicator).toBeVisible();
  await waitForCardsToSettle(page);
  const indicatorBox = await boxOf(indicator);
  const indicatorCenterX = indicatorBox.x + indicatorBox.width / 2;
  expect(indicatorCenterX).toBeGreaterThan(alpha.x + alpha.width);
  expect(indicatorCenterX).toBeLessThan(
    (await boxOf(sortableCard(page, documentName(FILE_B)))).x
  );

  // 창 밖으로 나가면 표시가 사라진다.
  await dropFiles(page, { type: "leave" });
  await expect(indicator).toBeHidden();

  // 다시 끌어와 놓으면 alpha와 bravo 사이에 들어간다.
  await dropFiles(page, {
    type: "enter",
    paths: [FILE_C.path],
    position: between
  });
  await dropFiles(page, {
    type: "drop",
    paths: [FILE_C.path],
    position: between
  });
  await expect(page.getByTestId("document-card")).toHaveCount(3);
  await expect(indicator).toBeHidden();
  expect(await readCardOrder(page)).toEqual([
    documentName(FILE_A),
    documentName(FILE_C),
    documentName(FILE_B)
  ]);
  expect(await mergeAndReadSegments(page, files)).toEqual([
    wholeFile(FILE_A),
    wholeFile(FILE_C),
    wholeFile(FILE_B)
  ]);
});
