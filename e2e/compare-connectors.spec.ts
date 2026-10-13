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
  TextBox,
  TextSource
} from "../src/renderer/shared/api/bindings";

/**
 * 연결선(계획서 §7.1, 진행 가이드 Step 28, 시안 4).
 * - 화면 묶음과 SVG 끝점이 Rust golden(`connectors.stems.json`)과 같다: 행마다 같은 묶음이 같은 순서로
 *   있고, 끝점은 golden 묶음 상자를 pdf.js viewport로 바꾼 상자의 세로 가운데다(앱의 배율 1 변환과 다른
 *   길로 잰다). 확대·축소·창 크기를 바꿔도 같다.
 * - 스크롤하는 동안 `data-scrolling`으로 사라지고 멈추면 다시 나타난다.
 * - 툴바 "연결선"·상태바 "연결선 N개"·A만/B만·숨긴 종류·다른 행 대응·자리표시자, 호버·선택 강조
 * - 작은 배율에서 번호 태그가 겹치지 않는다.
 *
 * 결과는 Rust golden(`connectors.changes.json`·`connectors.stems.json`)과 같은 폴더의 픽스처 PDF로
 * 시드한다(사본 없이 읽는다).
 */

const PDF_CORE_TEST_DIRECTORY = path.join(
  __dirname,
  "..",
  "crates",
  "pdf-core",
  "tests"
);
const PDFJS_SETUP_MODULE = "/src/renderer/shared/lib/pdfjs/pdfjs-setup.ts";
const VIEWPORT = { width: 1280, height: 800 };
/** 창을 키우면 "맞춤" 배율이 커진다. */
const WIDE_VIEWPORT = { width: 1600, height: 900 };
const DEVICE_PIXEL_RATIO = 2;
/** 끝점 허용 오차(px): 좌표 반올림(0.01px)과 쪽 배치의 소수 px */
const ENDPOINT_TOLERANCE_PX = 1;
const GUTTER_PORTRAIT_PX = 120;
const GUTTER_LANDSCAPE_PX = 72;
/** 연결선 굵기(px): 평상시·강조 */
const STROKE_NORMAL = "2";
const STROKE_EMPHASIZED = "3";

test.use({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_PIXEL_RATIO });

function readCore(folder: string, name: string): Buffer {
  return readFileSync(path.join(PDF_CORE_TEST_DIRECTORY, folder, name));
}

interface GoldenStem {
  changeIds: string[];
  before: TextBox;
  after: TextBox;
}

interface GoldenRow {
  pages: [number, number];
  stems: GoldenStem[];
}

interface ConnectorsGolden {
  pagePairs: CompareResult["pagePairs"];
  pageSizes: CompareResult["pageSizes"];
  rows: GoldenRow[];
}

const CHANGES = JSON.parse(
  readCore("golden", "connectors.changes.json").toString("utf8")
) as Change[];
const GOLDEN = JSON.parse(
  readCore("golden", "connectors.stems.json").toString("utf8")
) as ConnectorsGolden;
const BEFORE_BYTES = readCore("fixtures", "connectors-a.pdf").toString(
  "base64"
);
const AFTER_BYTES = readCore("fixtures", "connectors-b.pdf").toString("base64");
const STEM_COUNT = GOLDEN.rows.reduce(
  (count, row) => count + row.stems.length,
  0
);

const HALF_TURN = 180;

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

function seedFile(
  displayName: string,
  bytesBase64: string,
  sizes: PageSize[]
): E2eMockFile {
  return {
    path: `/Users/e2e/originals/${displayName}`,
    displayName,
    pages: sizes.map(toPageInfo),
    bytesBase64
  };
}

const BEFORE_FILE = seedFile(
  "connectors-a.pdf",
  BEFORE_BYTES,
  GOLDEN.pageSizes.before
);
const AFTER_FILE = seedFile(
  "connectors-b.pdf",
  AFTER_BYTES,
  GOLDEN.pageSizes.after
);

/** 변경 쪽의 글자 상자. 앵커(글자가 없는 쪽)는 상자가 없다(ADR 0001 §4). */
function boxesOf(placement: Placement): TextBox[] {
  return placement.kind === "boxes" ? placement.boxes : [];
}

function textLayer(count: number): TextSource[] {
  return Array.from({ length: count }, () => "textLayer");
}

function connectorsResult(changes: Change[] = CHANGES): CompareResult {
  return {
    changes,
    pagePairs: GOLDEN.pagePairs,
    pageSizes: GOLDEN.pageSizes,
    pageSources: {
      before: textLayer(GOLDEN.pageSizes.before.length),
      after: textLayer(GOLDEN.pageSizes.after.length)
    },
    notices: []
  };
}

interface OpenResultParams {
  files?: [E2eMockFile, E2eMockFile];
  result?: CompareResult;
}

/** 홈 비교 카드에 두 파일을 놓고 비교를 실행해 결과 화면을 연다. */
async function openResult(
  page: Page,
  {
    files = [BEFORE_FILE, AFTER_FILE],
    result = connectorsResult()
  }: OpenResultParams = {}
): Promise<void> {
  const seed: E2eMockSeed = {
    files,
    compareScripts: [{ progress: [], result }]
  };
  await page.addInitScript((initialSeed) => {
    window.__E2E_MOCK_SEED__ = initialSeed;
  }, seed);
  await page.goto("/");
  const card = page.getByRole("region", { name: "PDF 비교", exact: true });
  const box = await card.boundingBox();
  if (!box) throw new Error("홈 비교 카드가 화면에 없습니다.");
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
  await page.getByRole("button", { name: "비교 실행" }).click();
  await expect(
    page.getByRole("heading", {
      name: `${files[0].displayName} → ${files[1].displayName}`
    })
  ).toBeVisible();
}

function pageArea(page: Page): Locator {
  return page.getByRole("region", { name: "페이지 영역" });
}

function rowGroup(page: Page, [before, after]: [number, number]): Locator {
  return pageArea(page).getByRole("group", {
    name: `A ${before + 1}쪽 · B ${after + 1}쪽`,
    exact: true
  });
}

function changeItem(page: Page, number: number): Locator {
  return page
    .getByRole("complementary", { name: "차이 목록" })
    .getByRole("button", { name: new RegExp(`^#${number} `) });
}

function connectorToggle(page: Page): Locator {
  return page.getByRole("checkbox", { name: "연결선" });
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

function stemGroups(scope: Locator): Locator {
  return scope.locator("[data-connector-layer] g[data-change-ids]");
}

function stemKey(stem: GoldenStem): string {
  return stem.changeIds.join(" ");
}

function changeNumber(id: string): number {
  return CHANGES.findIndex((change) => change.id === id) + 1;
}

interface ViewportCentersArgs {
  pdfjsSetupModule: string;
  pdfBase64: string;
  pageIndex: number;
  /** 쪽 그림이 화면에 놓인 너비(px) */
  displayWidth: number;
  boxes: TextBox[];
}

/**
 * 브라우저에서 돈다. 앱과 같은 pdf.js 설정으로 픽스처를 열어, 화면에 놓인 너비의 배율로 만든
 * viewport에서 상자마다 `convertToViewportRectangle`로 바꾼 사각형의 세로 가운데(px, 쪽 위 끝 기준)를
 * 돌려준다(앱은 배율 1 변환을 쪽 높이 비율로 맞추므로 다른 길이다).
 */
async function viewportCenters({
  pdfjsSetupModule,
  pdfBase64,
  pageIndex,
  displayWidth,
  boxes
}: ViewportCentersArgs): Promise<number[]> {
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
    return boxes.map(({ x, y, w, h }) => {
      const [, top, , bottom] = viewport.convertToViewportRectangle([
        x,
        y,
        x + w,
        y + h
      ]);
      return (top + bottom) / 2;
    });
  } finally {
    await loadingTask.destroy();
  }
}

/** 화면에 놓인 쪽이 가로인가(회전 90·270이면 너비·높이를 바꾼다) */
function isLandscape({ viewBox, rotation }: PageSize): boolean {
  const width = viewBox.right - viewBox.left;
  const height = viewBox.top - viewBox.bottom;
  return rotation % HALF_TURN === 0 ? width > height : height > width;
}

/** 거터 폭(계획서 §7.1): 한쪽이라도 가로 쪽이면 72px */
function gutterPxOf({ pages: [before, after] }: GoldenRow): number {
  const sizes = [
    GOLDEN.pageSizes.before[before],
    GOLDEN.pageSizes.after[after]
  ];
  return sizes.some(isLandscape) ? GUTTER_LANDSCAPE_PX : GUTTER_PORTRAIT_PX;
}

/** path `d`의 시작점과 끝점 */
function pathEnds(d: string): { start: number[]; end: number[] } {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return { start: numbers.slice(0, 2), end: numbers.slice(-2) };
}

/**
 * 행 하나의 연결선이 golden 묶음과 같은 묶음·순서이고, 끝점이 golden 묶음 상자를 pdf.js viewport로
 * 바꾼 상자의 세로 가운데에 있으며, x는 거터의 0과 너비다.
 */
async function expectRowMatchesGolden(page: Page, row: GoldenRow) {
  const group = rowGroup(page, row.pages);
  const layer = group.locator("[data-connector-layer]");
  await expect(stemGroups(group)).toHaveCount(row.stems.length);
  expect(
    await stemGroups(group).evaluateAll((groups) =>
      groups.map((element) => element.getAttribute("data-change-ids"))
    )
  ).toEqual(row.stems.map(stemKey));

  const [before, after] = row.pages;
  const beforeImage = group.getByRole("img", { name: `A ${before + 1}쪽` });
  const afterImage = group.getByRole("img", { name: `B ${after + 1}쪽` });
  const [layerBox, beforeBox, afterBox] = await Promise.all([
    layer.boundingBox(),
    beforeImage.boundingBox(),
    afterImage.boundingBox()
  ]);
  if (!layerBox || !beforeBox || !afterBox) {
    throw new Error(`행 ${row.pages}: 연결선이나 쪽 그림이 화면에 없습니다.`);
  }
  expect(layerBox.width).toBeCloseTo(gutterPxOf(row), 0);
  const [beforeCenters, afterCenters] = await Promise.all([
    page.evaluate(viewportCenters, {
      pdfjsSetupModule: PDFJS_SETUP_MODULE,
      pdfBase64: BEFORE_BYTES,
      pageIndex: before,
      displayWidth: beforeBox.width,
      boxes: row.stems.map((stem) => stem.before)
    }),
    page.evaluate(viewportCenters, {
      pdfjsSetupModule: PDFJS_SETUP_MODULE,
      pdfBase64: AFTER_BYTES,
      pageIndex: after,
      displayWidth: afterBox.width,
      boxes: row.stems.map((stem) => stem.after)
    })
  ]);

  for (const [index, stem] of row.stems.entries()) {
    const d = await group
      .locator(`g[data-change-ids="${stemKey(stem)}"] path`)
      .last()
      .getAttribute("d");
    const { start, end } = pathEnds(d ?? "");
    const message = `행 ${row.pages} 묶음 ${stemKey(stem)}: ${d}`;
    expect(start[0], message).toBe(0);
    expect(end[0], message).toBeCloseTo(layerBox.width, 1);
    expect(
      Math.abs(layerBox.y + start[1] - (beforeBox.y + beforeCenters[index])),
      message
    ).toBeLessThanOrEqual(ENDPOINT_TOLERANCE_PX);
    expect(
      Math.abs(layerBox.y + end[1] - (afterBox.y + afterCenters[index])),
      message
    ).toBeLessThanOrEqual(ENDPOINT_TOLERANCE_PX);
  }
}

const [PORTRAIT_ROW, LANDSCAPE_ROW] = GOLDEN.rows;

const MAX_ZOOM_PRESSES = 8;

/** 확대·축소 버튼을 눌러 배율 표시가 `percent`가 되게 한다. */
async function zoomTo(page: Page, percent: number): Promise<void> {
  const zoomLevel = page.getByRole("status", { name: "배율" });
  for (let press = 0; press < MAX_ZOOM_PRESSES; press += 1) {
    const current = Number((await zoomLevel.textContent())?.replace("%", ""));
    if (current === percent) return;
    await page
      .getByRole("button", { name: current < percent ? "확대" : "축소" })
      .click();
    await expect(zoomLevel).not.toHaveText(`${current}%`);
  }
  await expect(zoomLevel).toHaveText(`${percent}%`);
}

test("연결선 묶음과 끝점이 Rust golden과 같다(세로·가로 행), 확대·축소와 창 크기를 바꿔도 상자 가운데에 붙는다", async ({
  page
}) => {
  await openResult(page);
  await expect(connectorToggle(page)).toBeChecked();
  await expect(statusBar(page)).toContainText(`연결선 ${STEM_COUNT}개`);

  await expectRowMatchesGolden(page, PORTRAIT_ROW);
  await changeItem(
    page,
    changeNumber(LANDSCAPE_ROW.stems[0].changeIds[0])
  ).click();
  await expectRowMatchesGolden(page, LANDSCAPE_ROW);

  await changeItem(page, 1).click();
  const zoomLevel = page.getByRole("status", { name: "배율" });
  const fitPercent = (await zoomLevel.textContent()) ?? "";
  for (const percent of [75, 25]) {
    await zoomTo(page, percent);
    await expectRowMatchesGolden(page, PORTRAIT_ROW);
  }

  // 맞춤 배율은 창 너비를 따라간다.
  await page.getByRole("button", { name: "맞춤" }).click();
  await expect(zoomLevel).toHaveText(fitPercent);
  await page.setViewportSize(WIDE_VIEWPORT);
  await expect(zoomLevel).not.toHaveText(fitPercent);
  await expectRowMatchesGolden(page, PORTRAIT_ROW);
});

/** 페이지 영역 스크롤 컨테이너(react-virtuoso) */
function scroller(page: Page): Locator {
  return pageArea(page).locator("[data-virtuoso-scroller]");
}

/** 스크롤 속도를 scroll seek(600px/s) 아래로 두고 일정 시간 조금씩 스크롤한다. */
const SLOW_SCROLL = { STEP_PX: 3, INTERVAL_MS: 16, STEPS: 60 };

test("스크롤하는 동안 연결선이 사라졌다가 멈추면 다시 나타난다", async ({
  page
}) => {
  await openResult(page);
  // 맞춤 배율에서는 두 행이 거의 한 화면이라 스크롤할 거리가 없다.
  await zoomTo(page, 50);
  const layer = rowGroup(page, PORTRAIT_ROW.pages).locator(
    "[data-connector-layer]"
  );
  await expect(stemGroups(rowGroup(page, PORTRAIT_ROW.pages))).toHaveCount(
    PORTRAIT_ROW.stems.length
  );
  const opacity = () =>
    layer.evaluate((element) => getComputedStyle(element).opacity);
  await expect.poll(opacity).toBe("1");
  await expect(scroller(page)).not.toHaveAttribute("data-scrolling");

  await page.evaluate(({ STEP_PX, INTERVAL_MS, STEPS }) => {
    const element = document.querySelector("[data-virtuoso-scroller]");
    if (!element) throw new Error("스크롤 컨테이너가 없습니다.");
    let count = 0;
    const timer = setInterval(() => {
      element.scrollTop += STEP_PX;
      count += 1;
      if (count >= STEPS) clearInterval(timer);
    }, INTERVAL_MS);
  }, SLOW_SCROLL);

  await expect(scroller(page)).toHaveAttribute("data-scrolling", "");
  await expect.poll(opacity).toBe("0");
  await expect(scroller(page)).not.toHaveAttribute("data-scrolling");
  await expect.poll(opacity).toBe("1");
});

test("연결선 체크박스·A만/B만·숨긴 종류는 연결선과 상태바 개수를 끄고, 다른 행 대응·자리표시자 행은 잇지 않는다", async ({
  page
}) => {
  await openResult(page);
  const layers = pageArea(page).locator("[data-connector-layer]");
  await expect(layers.first()).toBeAttached();

  await connectorToggle(page).click();
  await expect(connectorToggle(page)).not.toBeChecked();
  await expect(layers).toHaveCount(0);
  await expect(statusBar(page)).not.toContainText("연결선");
  // 하이라이트는 그대로다(연결선과 별개).
  const [firstChange] = CHANGES;
  await expect(
    pageArea(page).locator(`rect[data-change-id="${firstChange.id}"]`)
  ).toHaveCount(
    boxesOf(firstChange.before).length + boxesOf(firstChange.after).length
  );
  await connectorToggle(page).click();
  await expect(layers.first()).toBeAttached();
  await expect(statusBar(page)).toContainText(`연결선 ${STEM_COUNT}개`);

  const viewMode = page.getByRole("group", { name: "보기 방식" });
  for (const mode of ["A만", "B만"]) {
    await viewMode.getByRole("button", { name: mode }).click();
    await expect(layers).toHaveCount(0);
    await expect(connectorToggle(page)).toBeDisabled();
    await expect(statusBar(page)).not.toContainText("연결선");
  }
  await viewMode.getByRole("button", { name: "나란히" }).click();
  await expect(connectorToggle(page)).toBeEnabled();
  await expect(layers.first()).toBeAttached();

  // 변경(`Replace`)을 숨기면 이을 변경이 없다. 남은 추가·삭제는 잇지 않는다.
  await page
    .getByRole("group", { name: "차이 종류" })
    .getByRole("button", { name: /^변경 / })
    .click();
  await expect(layers).toHaveCount(0);
  await expect(statusBar(page)).toContainText("연결선 0개");
});

test("대응이 다른 행에 있는 변경과 자리표시자 행에는 연결선이 없다", async ({
  page
}) => {
  const base = readCore("fixtures", "pages-base.pdf").toString("base64");
  const inserted = readCore("fixtures", "pages-insert.pdf").toString("base64");
  const a4: PageSize = {
    viewBox: { left: 0, bottom: 0, right: 595, top: 842 },
    rotation: 0
  };
  const sizes = (count: number) => Array.from({ length: count }, () => a4);
  const pagePairs = JSON.parse(
    readCore("golden", "pages-insert.page-pairs.json").toString("utf8")
  ) as CompareResult["pagePairs"];
  const box = (pageIndex: number): TextBox => ({
    page: pageIndex,
    x: 60,
    y: 700,
    w: 120,
    h: 12
  });
  /** A 2쪽(행 A 2쪽 · B 2쪽)과 B 3쪽(B만 있는 행)에 걸친 변경 */
  const crossRow: Change = {
    id: "cross-row",
    kind: "replace",
    before: {
      kind: "boxes",
      text: "A 쪽",
      boxes: [box(1)],
      minConfidence: null
    },
    after: {
      kind: "boxes",
      text: "B 쪽",
      boxes: [box(2)],
      minConfidence: null
    },
    pagePair: [1, 2],
    needsReview: false
  };
  await openResult(page, {
    files: [
      seedFile("pages-base.pdf", base, sizes(5)),
      seedFile("pages-insert.pdf", inserted, sizes(6))
    ],
    result: {
      changes: [crossRow],
      pagePairs,
      pageSizes: { before: sizes(5), after: sizes(6) },
      pageSources: { before: textLayer(5), after: textLayer(6) },
      notices: []
    }
  });

  await expect(
    pageArea(page).locator(`rect[data-change-id="${crossRow.id}"]`).first()
  ).toBeAttached();
  await expect(pageArea(page).locator("[data-connector-layer]")).toHaveCount(0);
  await expect(statusBar(page)).toContainText("연결선 0개");
  await changeItem(page, 1).click();
  const placeholderRow = pageArea(page).getByRole("group", {
    name: "B 3쪽",
    exact: true
  });
  await expect(placeholderRow).toContainText("A에 없는 쪽이에요");
  await expect(
    placeholderRow.locator("[data-connector-gutter]")
  ).toBeAttached();
  await expect(placeholderRow.locator("[data-connector-layer]")).toHaveCount(0);
});

test("연결선을 가리키면 묶음의 변경을 페이지·목록에서 함께 강조하고, 묶음 안 변경을 고르면 선이 그 종류 색으로 굵어진다", async ({
  page
}) => {
  await openResult(page);
  const row = rowGroup(page, PORTRAIT_ROW.pages);
  const triple = PORTRAIT_ROW.stems.find((stem) => stem.changeIds.length === 3);
  if (!triple) throw new Error("golden에 인접 변경 3개 묶음이 없습니다.");
  const tripleGroup = row.locator(`g[data-change-ids="${stemKey(triple)}"]`);
  const visible = tripleGroup.locator("path").last();
  await expect(visible).toHaveAttribute("stroke-width", STROKE_NORMAL);

  const hit = await tripleGroup.locator("path").first().boundingBox();
  if (!hit) throw new Error("연결선이 화면에 없습니다.");
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await expect(tripleGroup).toHaveAttribute("data-emphasized", "true");
  await expect(visible).toHaveAttribute("stroke-width", STROKE_EMPHASIZED);
  for (const id of triple.changeIds) {
    await expect(changeItem(page, changeNumber(id))).toHaveAttribute(
      "data-hovered",
      "true"
    );
    for (const side of ["before", "after"]) {
      await expect(
        row.locator(`rect[data-change-id="${id}"][data-side="${side}"]`)
      ).toHaveAttribute("data-hovered", "true");
    }
  }
  const outside = PORTRAIT_ROW.stems.find((stem) => stem !== triple);
  if (!outside) throw new Error("golden에 다른 묶음이 없습니다.");
  await expect(
    changeItem(page, changeNumber(outside.changeIds[0]))
  ).not.toHaveAttribute("data-hovered", "true");

  await page.mouse.move(1, VIEWPORT.height / 2);
  await expect(tripleGroup).not.toHaveAttribute("data-emphasized", "true");
  await expect(
    changeItem(page, changeNumber(triple.changeIds[0]))
  ).not.toHaveAttribute("data-hovered", "true");

  // 묶음 가운데 변경을 고르면 묶음 전체가 고른 상태다.
  await changeItem(page, changeNumber(triple.changeIds[1])).click();
  await expect(tripleGroup).toHaveAttribute("data-emphasized", "true");
  await expect(visible).toHaveAttribute("stroke-width", STROKE_EMPHASIZED);
  await expect(visible).toHaveClass(/stroke-diff-change/);
});

interface TagBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function tagBoxes(scope: Locator): Promise<TagBox[]> {
  return scope.locator("[data-number-tag]").evaluateAll((tags) =>
    tags.map((tag) => {
      const rect = tag.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      };
    })
  );
}

function overlapping(boxes: TagBox[]): [TagBox, TagBox][] {
  return boxes.flatMap((first, index) =>
    boxes
      .slice(index + 1)
      .filter(
        (second) =>
          first.left < second.right &&
          second.left < first.right &&
          first.top < second.bottom &&
          second.top < first.bottom
      )
      .map((second): [TagBox, TagBox] => [first, second])
  );
}

test("작은 배율에서는 겹치는 번호 태그를 빼고, 키우면 모든 태그가 보인다", async ({
  page
}) => {
  await openResult(page);
  const beforePage = rowGroup(page, PORTRAIT_ROW.pages).getByRole("img", {
    name: "A 1쪽"
  });
  const taggedOnPage = CHANGES.filter((change) =>
    boxesOf(change.before).some((box) => box.page === 0)
  ).length;
  await zoomTo(page, 25);
  await expect(beforePage.locator("[data-number-tag]").first()).toBeAttached();
  const small = await tagBoxes(beforePage);
  expect(small.length).toBeLessThan(taggedOnPage);
  expect(overlapping(small)).toEqual([]);

  await zoomTo(page, 100);
  await expect(beforePage.locator("[data-number-tag]")).toHaveCount(
    taggedOnPage
  );
  expect(overlapping(await tagBoxes(beforePage))).toEqual([]);
});
