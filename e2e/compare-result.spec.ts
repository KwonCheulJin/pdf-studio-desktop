import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed
} from "../src/renderer/app/providers/e2e-platform";
import type {
  Change,
  CompareResult,
  PageInfo,
  PageSize,
  Placement,
  TextSource
} from "../src/renderer/shared/api/bindings";

/**
 * 비교 결과 미리보기(계획서 P3-4, 진행 가이드 Step 27, 시안 4).
 * - 머리(제목·문서 정보·걸린 시간·새 비교·내보내기·⋯), 종류 칩·확인 필요 칩, 이전/다음·키보드,
 *   보기 방식, 배율, 안내 띠, 쪽별 차이 목록, A·B 두 패널(같은 쌍 행 배치), 미니맵
 * - 하이라이트 사각형이 pdf.js 글자 위치와 맞는지(CropBox 오프셋·회전·UserUnit)
 * - 화면 근처 행만 그리는지(pdf.js 렌더 캐시 항목 수)
 *
 * 결과는 시드(`compareScripts[].result`)로 넣는다. Rust golden(`crates/pdf-core/tests/golden`)과
 * 같은 폴더의 픽스처 PDF를 사본 없이 그대로 읽는다(ADR 0001 §7).
 */

const PDF_CORE_TEST_DIRECTORY = path.join(
  __dirname,
  "..",
  "crates",
  "pdf-core",
  "tests"
);
const PDFJS_SETUP_MODULE = "/src/renderer/shared/lib/pdfjs/pdfjs-setup.ts";

const DEVICE_PIXEL_RATIO = 2;
const VIEWPORT = { width: 1280, height: 800 };

test.use({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_PIXEL_RATIO });

function readCoreFixture(stem: string): string {
  return readFileSync(
    path.join(PDF_CORE_TEST_DIRECTORY, "fixtures", `${stem}.pdf`)
  ).toString("base64");
}

function readE2eFixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", name)).toString(
    "base64"
  );
}

function readGolden<T>(name: string): T {
  return JSON.parse(
    readFileSync(path.join(PDF_CORE_TEST_DIRECTORY, "golden", name), "utf8")
  ) as T;
}

const HALF_TURN = 180;

/** `openFiles`가 돌려줄 쪽 정보. 보이는 영역을 MediaBox·CropBox 둘 다로 둔다. */
function toPageInfo({ viewBox, rotation }: PageSize): PageInfo {
  const width = viewBox.right - viewBox.left;
  const height = viewBox.top - viewBox.bottom;
  const isQuarterTurn = rotation % HALF_TURN !== 0;
  return {
    widthPt: isQuarterTurn ? height : width,
    heightPt: isQuarterTurn ? width : height,
    rotation,
    mediaBox: viewBox,
    cropBox: viewBox
  };
}

interface SeedFileParams {
  displayName: string;
  bytesBase64: string;
  sizes: PageSize[];
}

function seedFile({
  displayName,
  bytesBase64,
  sizes
}: SeedFileParams): E2eMockFile {
  return {
    path: `/Users/e2e/originals/${displayName}`,
    displayName,
    pages: sizes.map(toPageInfo),
    bytesBase64
  };
}

const A4_SIZE: PageSize = {
  viewBox: { left: 0, bottom: 0, right: 595, top: 842 },
  rotation: 0
};

function a4Sizes(pageCount: number): PageSize[] {
  return Array.from({ length: pageCount }, () => A4_SIZE);
}

function textLayerSources(pageCount: number): TextSource[] {
  return Array.from({ length: pageCount }, () => "textLayer");
}

/** diff-base.pdf(A) ↔ diff-edit.pdf(B), 각 2쪽. 변경은 Rust golden 7개(ADR 0001 §7) */
const DIFF_CHANGES = readGolden<Change[]>("diff-edit.changes.json");
const DIFF_BASE = seedFile({
  displayName: "diff-base.pdf",
  bytesBase64: readCoreFixture("diff-base"),
  sizes: a4Sizes(2)
});
const DIFF_EDIT = seedFile({
  displayName: "diff-edit.pdf",
  bytesBase64: readCoreFixture("diff-edit"),
  sizes: a4Sizes(2)
});

function diffResult(overrides: Partial<CompareResult> = {}): CompareResult {
  return {
    changes: DIFF_CHANGES,
    pagePairs: [
      [0, 0],
      [1, 1]
    ],
    pageSizes: { before: a4Sizes(2), after: a4Sizes(2) },
    pageSources: { before: textLayerSources(2), after: textLayerSources(2) },
    notices: [],
    ...overrides
  };
}

interface OpenResultParams {
  files: [E2eMockFile, E2eMockFile];
  /** 없으면 mock이 차이 없는 결과를 돌려준다. */
  result?: CompareResult;
  /** 실행 전에 옵션 화면에서 할 일 */
  beforeRun?: (page: Page) => Promise<void>;
  /** 시드를 넣는 스크립트 다음에 페이지에서 먼저 돌릴 스크립트 */
  holdReadPdf?: boolean;
}

/** 홈 비교 카드에 두 파일을 놓고 비교를 실행해 결과 화면을 연다. */
async function openResult(
  page: Page,
  { files, result, beforeRun, holdReadPdf = false }: OpenResultParams
): Promise<void> {
  const seed: E2eMockSeed = {
    files,
    compareScripts: [{ progress: [], result }]
  };
  await page.addInitScript(
    ({ initialSeed, shouldHold }) => {
      window.__E2E_MOCK_SEED__ = initialSeed;
      if (shouldHold) {
        window.__E2E_HOLD_READ_PDF__ = new Promise<void>((resolve) => {
          window.__E2E_RELEASE_READ_PDF__ = resolve;
        });
      }
    },
    { initialSeed: seed, shouldHold: holdReadPdf }
  );
  await page.goto("/");
  const card = page.getByRole("button", { name: "PDF 비교", exact: true });
  const box = await card.boundingBox();
  if (!box) {
    throw new Error("홈 비교 카드가 화면에 없습니다.");
  }
  const position = {
    x: (box.x + box.width / 2) * DEVICE_PIXEL_RATIO,
    y: (box.y + box.height / 2) * DEVICE_PIXEL_RATIO
  };
  const paths = files.map((file) => file.path);
  for (const type of ["enter", "drop"] as const) {
    await page.evaluate(
      (dropEvent) => {
        window.__E2E_FILE_DROP__?.(dropEvent);
      },
      { type, paths, position }
    );
  }
  const runButton = page.getByRole("button", { name: "비교 실행" });
  await expect(runButton).toBeEnabled();
  await beforeRun?.(page);
  await runButton.click();
  await expect(
    page.getByRole("heading", {
      name: `${files[0].displayName} → ${files[1].displayName}`
    })
  ).toBeVisible();
}

function changeList(page: Page): Locator {
  return page.getByRole("complementary", { name: "차이 목록" });
}

function changeItems(page: Page): Locator {
  return changeList(page).getByRole("button", { name: /^#\d+ / });
}

function changeItem(page: Page, number: number): Locator {
  return changeList(page).getByRole("button", {
    name: new RegExp(`^#${number} `)
  });
}

function pageArea(page: Page): Locator {
  return page.getByRole("region", { name: "페이지 영역" });
}

/** 문서 하나의 패널(나란히 보기는 A·B 두 패널이 따로 스크롤한다, 계획서 §7.1) */
function pane(page: Page, badge: string): Locator {
  return pageArea(page).getByRole("group", { name: `${badge} 문서` });
}

function pageImage(page: Page, name: string): Locator {
  return pageArea(page).getByRole("img", { name, exact: true });
}

function kindChip(page: Page, name: string): Locator {
  return page
    .getByRole("group", { name: "차이 종류" })
    .getByRole("button", { name, exact: true });
}

function position(page: Page): Locator {
  return page.getByRole("status", { name: "차이 위치" });
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

function highlight(page: Page, change: Change, side: string): Locator {
  return pageArea(page).locator(
    `rect[data-change-id="${change.id}"][data-side="${side}"]`
  );
}

test("결과 화면: 머리·칩·안내 띠·쪽별 목록·페이지 행이 보이고 첫 차이를 펼친다", async ({
  page
}) => {
  await openResult(page, {
    files: [DIFF_BASE, DIFF_EDIT],
    result: diffResult({
      notices: [
        {
          kind: "noTextLayer",
          side: "after",
          reason: "ocrUnavailable",
          pages: [1]
        }
      ]
    }),
    beforeRun: async (currentPage) => {
      await currentPage
        .getByRole("region", { name: "실행 전 옵션" })
        .getByRole("checkbox", { name: "머리말" })
        .click();
    }
  });

  const header = page.locator("header");
  await expect(header).toContainText("A diff-base.pdf · 2쪽");
  await expect(header).toContainText("B diff-edit.pdf · 2쪽");
  await expect(header.getByText(/^\d+\.\d초 만에 완료$/)).toBeVisible();
  await expect(header.getByRole("button", { name: "새 비교" })).toBeEnabled();
  await expect(header.getByRole("button", { name: "내보내기" })).toBeEnabled();
  await expect(header.getByRole("button", { name: "더 보기" })).toBeVisible();

  // 종류 칩은 그 종류의 차이 수(golden: 변경 4 · 삭제 1 · 추가 2), 확인 필요가 없으면 칩이 없다.
  for (const name of ["추가 2", "삭제 1", "변경 4"]) {
    await expect(kindChip(page, name)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByRole("button", { name: /^확인 필요/ })).toHaveCount(0);
  await expect(position(page)).toHaveText("1 / 7");

  // 안내 띠: 뺀 줄(옵션)과 notices를 한 줄로, "자세히"로 줄마다
  const notices = page.getByRole("region", { name: "비교 안내" });
  await expect(notices).toContainText("안내 2건");
  await expect(notices).toContainText("머리말을 양쪽에서 뺐어요");
  await expect(notices).toContainText(
    "B의 2쪽은 글자층이 없어 비교하지 못했어요"
  );
  await notices.getByRole("button", { name: "자세히" }).click();
  await expect(notices.getByRole("listitem")).toHaveCount(2);
  await notices.getByRole("button", { name: "접기" }).click();
  await expect(notices.getByRole("listitem")).toHaveCount(0);

  // 쪽별 묶기: diff 순서대로 1쪽 4건, 2쪽 3건
  const list = changeList(page);
  await expect(list.getByText("차이 7건", { exact: true })).toBeVisible();
  await expect(list.getByRole("group", { name: "1쪽 · 4건" })).toBeVisible();
  await expect(list.getByRole("group", { name: "2쪽 · 3건" })).toBeVisible();
  await expect(
    list.getByRole("group", { name: "1쪽 · 4건" }).getByRole("button")
  ).toHaveCount(4);
  await expect(changeItems(page)).toHaveCount(7);

  // 처음 연 결과는 첫 변경을 골라 전/후 상자로 펼친다.
  const first = changeItem(page, 1);
  await expect(first).toHaveAttribute("aria-current", "true");
  await expect(first).toContainText("A 변경 전 · 1쪽");
  await expect(first).toContainText("B 변경 후 · 1쪽");
  await expect(first).toContainText("2026년 12월 31일까지로");
  await expect(changeItem(page, 2)).not.toContainText("변경 전");

  // 쪽별로 묶기를 끄면 머리 없는 한 줄 목록
  await list.getByRole("checkbox", { name: "쪽별로 묶기" }).click();
  await expect(list.getByRole("group")).toHaveCount(0);
  await expect(changeItems(page)).toHaveCount(7);

  // 목록 접기 → 좁은 레일, 다시 펼치기
  await list.getByRole("button", { name: "목록 접기" }).click();
  await expect(changeItems(page)).toHaveCount(0);
  await changeList(page).getByRole("button", { name: "목록 펼치기" }).click();
  await expect(changeItems(page)).toHaveCount(7);

  // 페이지 행: A 패널과 B 패널에 같은 쌍(A 1쪽 · B 1쪽)의 행, 캡션에 파일 이름·쪽
  const pair = { name: "A 1쪽 · B 1쪽" };
  await expect(pane(page, "A").getByRole("group", pair)).toContainText(
    "diff-base.pdf · 1쪽"
  );
  await expect(pane(page, "B").getByRole("group", pair)).toContainText(
    "diff-edit.pdf · 1쪽"
  );
  await expect(pageImage(page, "A 1쪽")).toHaveAttribute("aria-busy", "false");
  await expect(pageImage(page, "B 1쪽")).toHaveAttribute("aria-busy", "false");
  await expect(highlight(page, DIFF_CHANGES[0], "before")).toHaveCount(3);
  await expect(highlight(page, DIFF_CHANGES[1], "before")).toHaveCount(1);

  // 미니맵 눈금은 보이는 변경마다 하나
  await expect(
    page
      .getByRole("img", { name: "문서 전체 미니맵" })
      .locator("[data-change-id]")
  ).toHaveCount(7);

  await expect(statusBar(page)).toContainText("차이 7건");
  await expect(
    page.getByRole("status").filter({ hasText: "상태: 완료" })
  ).toBeVisible();
});

test("종류 칩으로 숨기면 목록·페이지·미니맵·개수가 바뀌고, 모두 숨기면 필터 초기화로 돌아온다", async ({
  page
}) => {
  await openResult(page, {
    files: [DIFF_BASE, DIFF_EDIT],
    result: diffResult()
  });
  const minimapTicks = page
    .getByRole("img", { name: "문서 전체 미니맵" })
    .locator("[data-change-id]");
  await expect(highlight(page, DIFF_CHANGES[0], "after")).toHaveCount(3);

  await kindChip(page, "변경 4").click();

  await expect(kindChip(page, "변경 4")).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  await expect(page.getByText("4개 숨김", { exact: true })).toBeVisible();
  await expect(changeItems(page)).toHaveCount(3);
  await expect(
    changeList(page).getByText("차이 3건", { exact: true })
  ).toBeVisible();
  await expect(minimapTicks).toHaveCount(3);
  // 고른 #1(변경)이 숨겨져 위치는 비고, 다음은 숨기지 않은 다음 변경(#2 삭제)이다.
  await expect(position(page)).toHaveText("– / 3");
  await expect(highlight(page, DIFF_CHANGES[0], "after")).toHaveCount(0);
  await expect(highlight(page, DIFF_CHANGES[1], "before")).toHaveCount(1);
  await page.getByRole("button", { name: "다음" }).click();
  await expect(position(page)).toHaveText("1 / 3");
  await expect(changeItem(page, 2)).toHaveAttribute("aria-current", "true");

  await kindChip(page, "추가 2").click();
  await kindChip(page, "삭제 1").click();
  await expect(changeItems(page)).toHaveCount(0);
  await expect(page.getByText("7개 숨김", { exact: true })).toBeVisible();
  await expect(changeList(page)).toContainText("모든 차이를 숨겼어요");
  await expect(position(page)).toHaveText("– / 0");

  await changeList(page).getByRole("button", { name: "필터 초기화" }).click();

  for (const name of ["추가 2", "삭제 1", "변경 4"]) {
    await expect(kindChip(page, name)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(changeItems(page)).toHaveCount(7);
  await expect(page.getByText(/개 숨김$/)).toHaveCount(0);
  await expect(minimapTicks).toHaveCount(7);
});

/** 상자가 페이지 영역(스크롤 컨테이너) 안에 다 보이는가 */
async function expectInsidePageArea(page: Page, target: Locator) {
  const area = await pageArea(page).boundingBox();
  const box = await target.boundingBox();
  if (!area || !box) {
    throw new Error("페이지 영역이나 상자가 화면에 없습니다.");
  }
  expect(box.y).toBeGreaterThanOrEqual(area.y);
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
}

test("이전/다음과 ↑↓·j/k로 차이를 옮기면 목록 항목이 펼쳐지고 페이지가 그 상자로 스크롤된다", async ({
  page
}) => {
  await openResult(page, {
    files: [DIFF_BASE, DIFF_EDIT],
    result: diffResult()
  });
  const previous = page.getByRole("button", { name: "이전" });
  const next = page.getByRole("button", { name: "다음" });
  await expect(position(page)).toHaveText("1 / 7");
  await expect(previous).toBeDisabled();

  await next.click();
  await expect(position(page)).toHaveText("2 / 7");
  await expect(changeItem(page, 2)).toHaveAttribute("aria-current", "true");
  await expect(changeItem(page, 1)).not.toHaveAttribute("aria-current", "true");

  await page.keyboard.press("j");
  await expect(position(page)).toHaveText("3 / 7");
  await page.keyboard.press("ArrowDown");
  await expect(position(page)).toHaveText("4 / 7");
  await page.keyboard.press("k");
  await expect(position(page)).toHaveText("3 / 7");
  await page.keyboard.press("ArrowUp");
  await expect(position(page)).toHaveText("2 / 7");

  // 2쪽의 추가(#5, B 쪽에만 상자)로 가면 그 행으로 스크롤하고 상자가 화면 안에 온다.
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(position(page)).toHaveText("5 / 7");
  await expect(changeItem(page, 5)).toContainText("B 변경 후 · 2쪽");
  const inserted = highlight(page, DIFF_CHANGES[4], "after").first();
  await expect(inserted).toBeVisible();
  await expectInsidePageArea(page, inserted);
  await expect(page.getByRole("status", { name: "현재 쪽" })).toHaveText(
    "2 / 2쪽"
  );

  await next.click();
  await next.click();
  await expect(position(page)).toHaveText("7 / 7");
  await expect(next).toBeDisabled();

  // 목록 항목을 누르면 그 변경으로 옮긴다.
  await changeItem(page, 1).click();
  await expect(position(page)).toHaveText("1 / 7");
  await expectInsidePageArea(
    page,
    highlight(page, DIFF_CHANGES[0], "before").first()
  );
});

test("보기 방식 A만·B만은 반대편과 거터를 숨기고, 확대·축소·맞춤은 쪽 크기와 배율을 바꾼다", async ({
  page
}) => {
  await openResult(page, {
    files: [DIFF_BASE, DIFF_EDIT],
    result: diffResult()
  });
  const viewMode = page.getByRole("group", { name: "보기 방식" });
  const gutters = pageArea(page).locator("[data-connector-gutter]");
  await expect(
    viewMode.getByRole("button", { name: "나란히" })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(pageImage(page, "A 1쪽")).toBeVisible();
  await expect(pageImage(page, "B 1쪽")).toBeVisible();
  expect(await gutters.count()).toBeGreaterThan(0);

  await viewMode.getByRole("button", { name: "A만" }).click();
  await expect(pageImage(page, "A 1쪽")).toBeVisible();
  await expect(pageImage(page, "B 1쪽")).toHaveCount(0);
  await expect(gutters).toHaveCount(0);
  await expect(page.getByRole("status", { name: "현재 쪽" })).toHaveText(
    "1 / 2쪽"
  );

  await viewMode.getByRole("button", { name: "B만" }).click();
  await expect(pageImage(page, "B 1쪽")).toBeVisible();
  await expect(pageImage(page, "A 1쪽")).toHaveCount(0);
  await expect(gutters).toHaveCount(0);

  await viewMode.getByRole("button", { name: "나란히" }).click();
  await expect(pageImage(page, "A 1쪽")).toBeVisible();
  await expect(pageImage(page, "B 1쪽")).toBeVisible();

  // 맞춤: 1280 창에서 A4가 칸에 여백을 두고 들어간다(시안 4 쪽 너비 약 330px).
  const zoomLevel = page.getByRole("status", { name: "배율" });
  const fit = page.getByRole("button", { name: "맞춤" });
  await expect(fit).toHaveAttribute("aria-pressed", "true");
  const fitWidth = (await pageImage(page, "A 1쪽").boundingBox())?.width ?? 0;
  expect(fitWidth).toBeGreaterThan(300);
  expect(fitWidth).toBeLessThan(360);
  const fitPercent = Number((await zoomLevel.textContent())?.replace("%", ""));

  await page.getByRole("button", { name: "확대" }).click();
  await expect(fit).toHaveAttribute("aria-pressed", "false");
  await expect(zoomLevel).toHaveText("50%");
  await expect
    .poll(async () => (await pageImage(page, "A 1쪽").boundingBox())?.width)
    .toBeCloseTo((595 * 96) / 72 / 2, 0);
  await page.getByRole("button", { name: "확대" }).click();
  await expect(zoomLevel).toHaveText("75%");
  await page.getByRole("button", { name: "축소" }).click();
  await expect(zoomLevel).toHaveText("50%");

  await fit.click();
  await expect(zoomLevel).toHaveText(`${fitPercent}%`);
  await expect
    .poll(async () => (await pageImage(page, "A 1쪽").boundingBox())?.width)
    .toBeCloseTo(fitWidth, 0);
});

/** 패널 스크롤 컨테이너(Virtuoso) */
function paneScroller(page: Page, badge: string): Locator {
  return pane(page, badge).locator("[data-virtuoso-scroller]");
}

async function scrollbarWidthOf(scroller: Locator): Promise<string> {
  return scroller.evaluate((element) => getComputedStyle(element).scrollbarWidth);
}

test("나란히 보기는 A 패널 스크롤바를 숨기고 B 것만 남기며, A는 휠로 스크롤되고 A만 보기는 스크롤바를 보인다", async ({
  page
}) => {
  await openResult(page, {
    files: [DIFF_BASE, DIFF_EDIT],
    result: diffResult()
  });
  const scrollerA = paneScroller(page, "A");
  const scrollerB = paneScroller(page, "B");
  await expect(pageImage(page, "A 1쪽")).toBeVisible();
  expect(await scrollbarWidthOf(scrollerA)).toBe("none");
  expect(await scrollbarWidthOf(scrollerB)).not.toBe("none");

  // 스크롤바만 숨겼다: 동기 스크롤을 끄고 A 위에서 휠을 굴리면 A만 움직인다.
  await page.getByRole("checkbox", { name: "동기 스크롤" }).uncheck();
  const box = await scrollerA.boundingBox();
  if (!box) {
    throw new Error("A 패널이 화면에 없습니다.");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => scrollerA.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const viewMode = page.getByRole("group", { name: "보기 방식" });
  await viewMode.getByRole("button", { name: "A만" }).click();
  await expect(pageImage(page, "A 1쪽")).toBeVisible();
  expect(await scrollbarWidthOf(paneScroller(page, "A"))).not.toBe("none");
});

const PAGES_INSERT_PAIRS = readGolden<CompareResult["pagePairs"]>(
  "pages-insert.page-pairs.json"
);

test("짝 없는 쪽은 반대편에 자리표시를 두고, 목록 머리와 캡션은 있는 쪽만 보인다", async ({
  page
}) => {
  const base = seedFile({
    displayName: "pages-base.pdf",
    bytesBase64: readCoreFixture("pages-base"),
    sizes: a4Sizes(5)
  });
  const inserted = seedFile({
    displayName: "pages-insert.pdf",
    bytesBase64: readCoreFixture("pages-insert"),
    sizes: a4Sizes(6)
  });
  /** 새 쪽(B 2쪽 = 0부터 2)에 생긴 추가 하나 */
  const newPage: Change = {
    id: "new-page",
    kind: "insert",
    before: { kind: "anchor", page: 1, x: 300, y: 600, h: 14 },
    after: {
      kind: "boxes",
      text: "새 쪽",
      boxes: [{ page: 2, x: 60, y: 700, w: 200, h: 14 }],
      minConfidence: null
    },
    pagePair: [null, 2],
    needsReview: false
  };
  await openResult(page, {
    files: [base, inserted],
    result: {
      changes: [newPage],
      pagePairs: PAGES_INSERT_PAIRS,
      pageSizes: { before: a4Sizes(5), after: a4Sizes(6) },
      pageSources: { before: textLayerSources(5), after: textLayerSources(6) },
      notices: []
    }
  });

  await expect(
    changeList(page).getByRole("group", { name: "B 3쪽 · 1건" })
  ).toBeVisible();
  await changeItem(page, 1).click();

  // B만 있는 행: A 패널에는 자리표시, B 패널에는 B 3쪽. 동기 스크롤이라 두 행이 같은 높이에 있다.
  const unpaired = { name: "B 3쪽", exact: true };
  const placeholderRow = pane(page, "A").getByRole("group", unpaired);
  const pageRow = pane(page, "B").getByRole("group", unpaired);
  await expect(placeholderRow).toBeVisible();
  await expect(placeholderRow).toContainText("A에 없는 쪽이에요");
  await expect(placeholderRow).toContainText("pages-base.pdf");
  await expect(placeholderRow.getByRole("img")).toHaveCount(0);
  await expect(pageRow).toContainText("pages-insert.pdf · 3쪽");
  await expect(pageRow.getByRole("img", { name: "B 3쪽" })).toBeVisible();
  const [placeholderBox, pageBox] = await Promise.all([
    placeholderRow.boundingBox(),
    pageRow.boundingBox()
  ]);
  expect(placeholderBox?.y).toBeCloseTo(pageBox?.y ?? Number.NaN, 0);
  await expectInsidePageArea(page, highlight(page, newPage, "after"));
  // 다음 행은 A 3쪽과 B 4쪽이 짝이다.
  await expect(
    pane(page, "B").getByRole("group", { name: "A 3쪽 · B 4쪽" })
  ).toBeAttached();
});

/** Rust `ExtractedPage` 직렬화 모양(필요한 필드만) */
interface GoldenExtractPage {
  size: PageSize;
  chars: {
    ch: string;
    glyph: {
      bounds: { page: number; x: number; y: number; w: number; h: number };
    } | null;
  }[];
}

const GEOMETRY_PAGES = readGolden<GoldenExtractPage[]>(
  "text-geometry.extract.json"
);

/** 하이라이트로 볼 쪽: CropBox 오프셋, MediaBox 원점, 회전 90+CropBox, 180, 270+오프셋, UserUnit 2, CropBox가 MediaBox 밖 */
const GEOMETRY_CASES = [
  { page: 1, label: "CropBox 오프셋" },
  { page: 2, label: "MediaBox 원점 100" },
  { page: 3, label: "회전 90 + CropBox" },
  { page: 4, label: "회전 180" },
  { page: 5, label: "회전 270 + 오프셋" },
  { page: 6, label: "UserUnit 2" },
  { page: 8, label: "교집합 없는 CropBox" }
] as const;

const LINE_BREAKS = new Set(["\r", "\n"]);

/** 쪽 첫 줄 글자(공백 제외) 상자들의 합집합과 그 글자 */
function firstLineOf(goldenPage: GoldenExtractPage) {
  const breakIndex = goldenPage.chars.findIndex(({ ch }) =>
    LINE_BREAKS.has(ch)
  );
  const glyphs = goldenPage.chars
    .slice(0, breakIndex < 0 ? undefined : breakIndex)
    .flatMap(({ ch, glyph }) =>
      glyph && ch.trim() !== "" ? [{ ch, bounds: glyph.bounds }] : []
    );
  const left = Math.min(...glyphs.map(({ bounds }) => bounds.x));
  const bottom = Math.min(...glyphs.map(({ bounds }) => bounds.y));
  const right = Math.max(...glyphs.map(({ bounds }) => bounds.x + bounds.w));
  const top = Math.max(...glyphs.map(({ bounds }) => bounds.y + bounds.h));
  return {
    text: glyphs.map(({ ch }) => ch).join(""),
    box: {
      page: glyphs[0].bounds.page,
      x: left,
      y: bottom,
      w: right - left,
      h: top - bottom
    }
  };
}

/** 화면 좌표(px, 쪽 그림 왼쪽 위 기준) */
interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface FirstItemArgs {
  pdfjsSetupModule: string;
  pdfBase64: string;
  pageIndex: number;
  /** 쪽 그림이 화면에 놓인 너비(px) */
  displayWidth: number;
}

interface MeasuredFirstItem {
  str: string;
  rect: ScreenRect;
  baselineAxis: "x" | "y";
  userUnit: number;
  /** pdf.js 배율(화면 너비 / 배율 1 viewport 너비) */
  scale: number;
}

/**
 * 브라우저에서 돈다. 앱과 같은 pdf.js 설정으로 픽스처를 열어, 쪽 첫 텍스트 항목의 화면 사각형을
 * 항목 transform·width·글꼴 ascent/descent로 구한다(`text-box-geometry.spec.ts`와 같은 방법, 앱의
 * 하이라이트 변환과 다른 길). 배율은 화면에 놓인 쪽 그림 너비로 맞춘다.
 */
async function measureFirstItem({
  pdfjsSetupModule,
  pdfBase64,
  pageIndex,
  displayWidth
}: FirstItemArgs): Promise<MeasuredFirstItem> {
  const {
    openPdfDocument
  }: typeof import("../src/renderer/shared/lib/pdfjs/pdfjs-setup") =
    await import(pdfjsSetupModule);
  const bytes = Uint8Array.from(atob(pdfBase64), (character) =>
    character.charCodeAt(0)
  );
  const loadingTask = openPdfDocument(bytes);
  try {
    const document = await loadingTask.promise;
    const pdfPage = await document.getPage(pageIndex + 1);
    const scale = displayWidth / pdfPage.getViewport({ scale: 1 }).width;
    const viewport = pdfPage.getViewport({ scale });
    const content = await pdfPage.getTextContent();
    const item = content.items.find(
      (candidate) => "str" in candidate && candidate.str.trim() !== ""
    );
    if (!item || !("str" in item)) {
      throw new Error(`${pageIndex}쪽에 텍스트 항목이 없습니다.`);
    }
    const [a, b, c, d, e, f] = item.transform as number[];
    const alongLength = Math.hypot(a, b);
    const upLength = Math.hypot(c, d);
    const style = content.styles[item.fontName];
    const ascent = (style?.ascent || 0.8) * item.height;
    const descent = (style?.descent || -0.2) * item.height;
    const corners = [
      [0, descent],
      [item.width, descent],
      [item.width, ascent],
      [0, ascent]
    ].map(([along, up]) => {
      const x = e + (a / alongLength) * along + (c / upLength) * up;
      const y = f + (b / alongLength) * along + (d / upLength) * up;
      const t = viewport.transform;
      return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
    });
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const deltaX = viewport.transform[0] * a + viewport.transform[2] * b;
    const deltaY = viewport.transform[1] * a + viewport.transform[3] * b;
    return {
      str: item.str,
      rect: {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys)
      },
      baselineAxis: Math.abs(deltaX) >= Math.abs(deltaY) ? "x" : "y",
      userUnit: pdfPage.userUnit,
      scale
    };
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * golden 상자와 pdf.js 항목 사이 허용 오차(pt, `text-box-geometry.spec.ts`와 같다) + 하이라이트
 * 테두리(1.5px)가 화면 상자에 더하는 몫. 원점·회전·UserUnit을 잘못 다루면 수십 px 어긋난다.
 */
const BOX_TOLERANCE_PT = 3;
const STROKE_ALLOWANCE_PX = 1;

test("하이라이트 사각형이 pdf.js 글자 위치와 맞는다(CropBox 오프셋·회전·UserUnit)", async ({
  page
}) => {
  const sizes = GEOMETRY_PAGES.map(({ size }) => size);
  const bytesBase64 = readCoreFixture("text-geometry");
  const before = seedFile({
    displayName: "geometry-a.pdf",
    bytesBase64,
    sizes
  });
  const after = seedFile({ displayName: "geometry-b.pdf", bytesBase64, sizes });
  const lines = GEOMETRY_CASES.map(({ page: pageIndex }) =>
    firstLineOf(GEOMETRY_PAGES[pageIndex])
  );
  const changes: Change[] = GEOMETRY_CASES.map(({ page: pageIndex }, index) => {
    const side: Placement = {
      kind: "boxes",
      text: lines[index].text,
      boxes: [lines[index].box],
      minConfidence: null
    };
    return {
      id: `geometry-${pageIndex}`,
      kind: "replace",
      before: side,
      after: side,
      pagePair: [pageIndex, pageIndex],
      needsReview: false
    };
  });
  await openResult(page, {
    files: [before, after],
    result: {
      changes,
      pagePairs: sizes.map((_size, index) => [index, index]),
      pageSizes: { before: sizes, after: sizes },
      pageSources: {
        before: textLayerSources(sizes.length),
        after: textLayerSources(sizes.length)
      },
      notices: []
    }
  });

  for (const [index, { page: pageIndex, label }] of GEOMETRY_CASES.entries()) {
    await changeItem(page, index + 1).click();
    for (const side of ["before", "after"] as const) {
      const badge = side === "before" ? "A" : "B";
      const image = pageImage(page, `${badge} ${pageIndex + 1}쪽`);
      await expect(image).toHaveAttribute("aria-busy", "false");
      const box = highlight(page, changes[index], side);
      await expect(box).toBeVisible();
      const imageBox = await image.boundingBox();
      const highlightBox = await box.boundingBox();
      if (!imageBox || !highlightBox) {
        throw new Error(`${label}: 쪽 그림이나 하이라이트가 화면에 없습니다.`);
      }
      const measured = await page.evaluate(measureFirstItem, {
        pdfjsSetupModule: PDFJS_SETUP_MODULE,
        pdfBase64: bytesBase64,
        pageIndex,
        displayWidth: imageBox.width
      });
      expect(
        measured.str.replace(/\s/g, ""),
        `${label}: pdf.js 첫 항목이 golden 첫 줄과 같다`
      ).toBe(lines[index].text);
      const shown: ScreenRect = {
        left: highlightBox.x - imageBox.x,
        top: highlightBox.y - imageBox.y,
        right: highlightBox.x + highlightBox.width - imageBox.x,
        bottom: highlightBox.y + highlightBox.height - imageBox.y
      };
      const tolerance =
        BOX_TOLERANCE_PT * measured.scale * measured.userUnit +
        STROKE_ALLOWANCE_PX;
      const item = measured.rect;
      const message = `${label} ${badge}: 하이라이트 ${JSON.stringify(shown)} / pdf.js ${JSON.stringify(item)}`;
      expect(shown.left, message).toBeGreaterThanOrEqual(item.left - tolerance);
      expect(shown.top, message).toBeGreaterThanOrEqual(item.top - tolerance);
      expect(shown.right, message).toBeLessThanOrEqual(item.right + tolerance);
      expect(shown.bottom, message).toBeLessThanOrEqual(
        item.bottom + tolerance
      );
      const [shownStart, shownEnd, itemStart, itemEnd] =
        measured.baselineAxis === "x"
          ? [shown.left, shown.right, item.left, item.right]
          : [shown.top, shown.bottom, item.top, item.bottom];
      expect(Math.abs(shownStart - itemStart), message).toBeLessThanOrEqual(
        tolerance
      );
      expect(Math.abs(shownEnd - itemEnd), message).toBeLessThanOrEqual(
        tolerance
      );
    }
  }
});

test("OCR로 읽은 쪽은 캡션·목록 머리에 OCR 배지, 확인 필요는 따로 세고 페이지에서 점 고리로 구별한다", async ({
  page
}) => {
  // golden의 #6(추가)·#7(변경)을 확인 필요로, B 2쪽을 OCR로 읽은 결과
  const reviewIndexes = new Set([5, 6]);
  const changes = DIFF_CHANGES.map((change, index) =>
    reviewIndexes.has(index) ? { ...change, needsReview: true } : change
  );
  await openResult(page, {
    files: [DIFF_BASE, DIFF_EDIT],
    result: diffResult({
      changes,
      pageSources: { before: textLayerSources(2), after: ["textLayer", "ocr"] }
    })
  });

  // 확인 필요는 차이 개수에 넣지 않는다(ADR 0001 §5): 추가 2 → 1, 변경 4 → 3
  for (const name of ["추가 1", "삭제 1", "변경 3", "확인 필요 2"]) {
    await expect(kindChip(page, name)).toHaveAttribute("aria-pressed", "true");
  }
  const list = changeList(page);
  await expect(list.getByText("차이 5건", { exact: true })).toBeVisible();
  await expect(list.getByText("확인 필요 2건", { exact: true })).toBeVisible();
  await expect(statusBar(page)).toContainText(/차이 5건\s*\|\s*확인 필요 2건/);
  await expect(position(page)).toHaveText("1 / 7");
  await expect(page.getByRole("region", { name: "비교 안내" })).toContainText(
    "OCR로 읽은 쪽 B 1개"
  );

  // 목록: 2쪽 묶음 머리에 B 쪽만 OCR이라는 배지, 확인 필요 항목에 배지
  const ocrGroup = list.getByRole("group", { name: /^2쪽/ });
  await expect(ocrGroup.getByText("B OCR", { exact: true })).toBeVisible();
  await expect(
    list.getByRole("group", { name: /^1쪽/ }).getByText(/OCR/)
  ).toHaveCount(0);
  await expect(changeItem(page, 7)).toContainText("확인 필요");
  await expect(changeItem(page, 4)).not.toContainText("확인 필요");

  // 페이지: B 2쪽 캡션에 OCR 배지, 확인 필요 상자는 바깥 점 고리로 차이 상자와 구별된다.
  await changeItem(page, 7).click();
  const row = pageArea(page).getByRole("group", { name: "A 2쪽 · B 2쪽" });
  await expect(row.getByText("OCR", { exact: true })).toHaveCount(1);
  await expect(
    pageArea(page)
      .getByRole("group", { name: "A 1쪽 · B 1쪽" })
      .getByText("OCR", { exact: true })
  ).toHaveCount(0);
  const review = highlight(page, changes[6], "after");
  await expect(review).toHaveAttribute("data-review", "true");
  const reviewShapes = review.locator("xpath=..").locator("rect");
  const plainShapes = highlight(page, changes[3], "after")
    .locator("xpath=..")
    .locator("rect");
  // 확인 필요: 상자 + 점 고리(+ 고른 변경 고리), 차이: 상자만
  await expect(reviewShapes).toHaveCount(3);
  await expect(reviewShapes.nth(1)).toHaveAttribute(
    "stroke-dasharray",
    "1.5 2.5"
  );
  await expect(plainShapes).toHaveCount(1);

  // 확인 필요 칩을 끄면 확인 필요만 숨긴다.
  await kindChip(page, "확인 필요 2").click();
  await expect(page.getByText("2개 숨김", { exact: true })).toBeVisible();
  await expect(changeItems(page)).toHaveCount(5);
  await expect(review).toHaveCount(0);
  await kindChip(page, "확인 필요 2").click();

  // 종류 필터는 확인 필요 개수에도 똑같이 적용된다(#7은 변경).
  await kindChip(page, "변경 3").click();
  await expect(kindChip(page, "확인 필요 1")).toBeVisible();
  await expect(kindChip(page, "추가 1")).toBeVisible();
  await expect(list.getByText("확인 필요 1건", { exact: true })).toBeVisible();
});

test("차이가 없으면 초록 체크와 '차이가 없어요'를 보이고 이동은 막힌다", async ({
  page
}) => {
  // 시드 결과가 없으면 mock은 두 범위를 차례로 짝지은 차이 없는 결과를 돌려준다.
  await openResult(page, { files: [DIFF_BASE, DIFF_EDIT] });

  await expect(changeList(page)).toContainText("차이가 없어요");
  await expect(
    changeList(page).getByText("차이 0건", { exact: true })
  ).toBeVisible();
  await expect(position(page)).toHaveText("– / 0");
  await expect(page.getByRole("button", { name: "이전" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "다음" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "비교 안내" })).toHaveCount(0);
  await expect(pageImage(page, "A 1쪽")).toHaveAttribute("aria-busy", "false");
  await expect(pageArea(page).locator("rect[data-change-id]")).toHaveCount(0);
  await expect(statusBar(page)).toContainText("차이 0건");
});

test("쪽을 받기 전에는 스켈레톤(aria-busy)을 보이고, 받으면 그림으로 바뀐다", async ({
  page
}) => {
  await openResult(page, {
    files: [DIFF_BASE, DIFF_EDIT],
    result: diffResult(),
    holdReadPdf: true
  });
  const first = pageImage(page, "A 1쪽");
  await expect(first).toHaveAttribute("aria-busy", "true");
  await expect(first.locator("img")).toHaveCount(0);
  // 화면 변환도 문서를 받아야 하므로 하이라이트는 아직 없다.
  await expect(highlight(page, DIFF_CHANGES[0], "before")).toHaveCount(0);

  await page.evaluate(() => window.__E2E_RELEASE_READ_PDF__?.());

  await expect(first).toHaveAttribute("aria-busy", "false");
  await expect(first.locator("img")).toHaveCount(1);
  await expect(highlight(page, DIFF_CHANGES[0], "before")).toHaveCount(3);
});

const HUNDRED_PAGES = 100;
/** 화면 근처(보이는 행 + 위아래 미리 그리는 높이)만 그리면 두 문서를 합쳐 이 수를 넘지 않는다. */
const NEAR_VIEW_RENDER_LIMIT = 10;

async function readRenderedPagePaths(page: Page): Promise<string[]> {
  return page.evaluate(
    () => window.__E2E_PDF_CACHE_STATS__?.().renderedPagePaths ?? []
  );
}

test("100쪽 결과: 화면 근처 행만 그리고, 멀리 건너뛰어도 사이의 행은 그리지 않는다", async ({
  page
}) => {
  const bytesBase64 = readE2eFixture("hundred-pages.pdf");
  const before = seedFile({
    displayName: "hundred-a.pdf",
    bytesBase64,
    sizes: a4Sizes(HUNDRED_PAGES)
  });
  const after = seedFile({
    displayName: "hundred-b.pdf",
    bytesBase64,
    sizes: a4Sizes(HUNDRED_PAGES)
  });
  const farPage = 79;
  const far: Change = {
    id: "far",
    kind: "delete",
    before: {
      kind: "boxes",
      text: `Page ${farPage + 1}`,
      boxes: [{ page: farPage, x: 72, y: 712, w: 150, h: 36 }],
      minConfidence: null
    },
    after: { kind: "anchor", page: farPage, x: 72, y: 712, h: 36 },
    pagePair: [farPage, null],
    needsReview: false
  };
  await openResult(page, {
    files: [before, after],
    result: {
      changes: [far],
      pagePairs: Array.from({ length: HUNDRED_PAGES }, (_value, index) => [
        index,
        index
      ]),
      pageSizes: {
        before: a4Sizes(HUNDRED_PAGES),
        after: a4Sizes(HUNDRED_PAGES)
      },
      pageSources: {
        before: textLayerSources(HUNDRED_PAGES),
        after: textLayerSources(HUNDRED_PAGES)
      },
      notices: []
    }
  });
  await expect(pageImage(page, "A 1쪽")).toHaveAttribute("aria-busy", "false");
  await expect(pageImage(page, "B 1쪽")).toHaveAttribute("aria-busy", "false");
  const initial = await readRenderedPagePaths(page);
  expect(initial.length).toBeGreaterThanOrEqual(2);
  expect(initial.length).toBeLessThanOrEqual(NEAR_VIEW_RENDER_LIMIT);

  // 80쪽 변경으로 건너뛴다. 사이의 70여 행은 그리지 않는다.
  await changeItem(page, 1).click();
  await expect(pageImage(page, `A ${farPage + 1}쪽`)).toHaveAttribute(
    "aria-busy",
    "false"
  );
  await expectInsidePageArea(page, highlight(page, far, "before"));
  await expect(pageImage(page, "A 1쪽")).toHaveCount(0);
  const afterJump = await readRenderedPagePaths(page);
  expect(afterJump.length - initial.length).toBeLessThanOrEqual(
    NEAR_VIEW_RENDER_LIMIT
  );
  await expect(page.getByRole("status", { name: "현재 쪽" })).toHaveText(
    `${farPage + 1} / ${HUNDRED_PAGES}쪽`
  );

  // 두 문서는 한 번씩만 읽는다(슬롯 썸네일과 결과 화면이 같은 문서를 쓴다).
  const reads = await page.evaluate(() => window.__E2E_MOCK_READS__ ?? []);
  expect(reads.filter((read) => read === before.path)).toHaveLength(1);
  expect(reads.filter((read) => read === after.path)).toHaveLength(1);
});

async function readCompareCount(page: Page): Promise<number> {
  return page.evaluate(() => (window.__E2E_MOCK_COMPARES__ ?? []).length);
}

test("뒤로·최근 결과·⋯ 다시 실행·슬롯 바꾸면 결과 지움·새 비교", async ({
  page
}) => {
  await openResult(page, {
    files: [DIFF_BASE, DIFF_EDIT],
    result: diffResult()
  });
  const title = page.getByRole("heading", {
    name: "diff-base.pdf → diff-edit.pdf"
  });

  // 뒤로: 옵션 화면, 결과는 남아 "최근 결과"로 돌아간다.
  await page.getByRole("button", { name: "옵션으로 돌아가기" }).click();
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
  await page.getByRole("button", { name: "최근 결과" }).click();
  await expect(title).toBeVisible();
  await expect(position(page)).toHaveText("1 / 7");

  // ⋯ → 다시 실행: 같은 문서·옵션으로 다시 비교한다(시드가 없어 이번엔 차이 없는 결과).
  await page.getByRole("button", { name: "더 보기" }).click();
  await page.getByRole("menuitem", { name: "다시 실행" }).click();
  await expect(changeList(page)).toContainText("차이가 없어요");
  expect(await readCompareCount(page)).toBe(2);

  // 슬롯 문서를 바꾸면(맞바꾸기) 결과와 어긋나므로 결과를 지운다.
  await page.getByRole("button", { name: "옵션으로 돌아가기" }).click();
  await expect(page.getByRole("button", { name: "최근 결과" })).toBeVisible();
  await page.getByRole("button", { name: "A와 B 바꾸기" }).click();
  await expect(page.getByRole("button", { name: "최근 결과" })).toHaveCount(0);

  // 새 비교: 문서·결과를 모두 비운 옵션 화면
  await page.getByRole("button", { name: "비교 실행" }).click();
  await expect(
    page.getByRole("heading", { name: "diff-edit.pdf → diff-base.pdf" })
  ).toBeVisible();
  await page.getByRole("button", { name: "새 비교" }).click();
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
  await expect(statusBar(page)).toContainText(/A 비어 있음\s*\|\s*B 비어 있음/);
  await expect(page.getByRole("button", { name: "최근 결과" })).toHaveCount(0);
});
