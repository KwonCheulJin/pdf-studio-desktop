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
  TextBox,
  TextSource
} from "../src/renderer/shared/api/bindings";

/**
 * 연결선(계획서 §7.1, 진행 가이드 Step 28-c·28-d, 시안 4).
 * - 화면 줄 표시·끝점·모양이 Rust golden(`connector-geometry.connectors.json`)과 같다: golden 끝의 줄 표시
 *   (`row`, Rust가 화면 방향으로 옮긴 pt)를 화면에 놓인 쪽 그림 너비의 배율로 놓은 사각형(앱의 pdf.js
 *   변환과 다른 길)과 줄 표시 사각형, 연결선이 나가는 점(줄 표시의 거터 쪽 변 세로 가운데)이 1px 안.
 *   회전 0·90·180·270, CropBox 오프셋, MediaBox 원점, 한 줄·여러 줄·여러 쪽·앵커 끝, 띠. 배율·창 크기를
 *   바꿔도 같다.
 * - 좌표 변환·경로·컬링 순수 함수(`lib/connector-geometry.ts`)를 개발 서버 모듈로 불러 확인한다(새 Vitest를
 *   쓰지 않는 정책, 경계값처럼 화면으로 정확히 맞출 수 없는 사례).
 * - 컬링·클램프·클릭 스크롤·hover·동기 스크롤 토글·연결선 체크박스·상태바 개수
 * - 연결선 200개에서 스크롤 프레임 시간(측정값은 계획서 §7.1에 기록)
 */

const PDF_CORE_TEST_DIRECTORY = path.join(
  __dirname,
  "..",
  "crates",
  "pdf-core",
  "tests"
);
const E2E_FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");
const PDFJS_SETUP_MODULE = "/src/renderer/shared/lib/pdfjs/pdfjs-setup.ts";
const PAGE_GEOMETRY_MODULE = "/src/renderer/shared/lib/pdfjs/page-geometry.ts";
const CONNECTOR_GEOMETRY_MODULE =
  "/src/renderer/widgets/compare-viewer/lib/connector-geometry.ts";
const VIEWPORT = { width: 1280, height: 800 };
/** 배율 50%에서도 가로 쪽이 패널에 들어가는 창 */
const WIDE_VIEWPORT = { width: 1920, height: 1080 };
const DEVICE_PIXEL_RATIO = 2;
/** 끝점 허용 오차(px): 좌표 반올림(0.01px)과 쪽 배치의 소수 px */
const ENDPOINT_TOLERANCE_PX = 1;
/** 화면 밖 끝을 패널 경계에서 들여놓는 거리(앱 `CONNECTOR_STYLE.CLAMP_INSET_PX`와 같은 값) */
const CLAMP_INSET_PX = 8;
/** 연결선 굵기(px): 평상시·강조 */
const STROKE_NORMAL = "1.5";
const STROKE_EMPHASIZED = "3";
/** 줄 표시 테두리 굵기(px): 평상시·강조(앱 `ROW_BAND_STYLE`과 같은 값) */
const ROW_STROKE_NORMAL = "1";
const ROW_STROKE_EMPHASIZED = "2";

test.use({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_PIXEL_RATIO });

function readCore(folder: string, name: string): Buffer {
  return readFileSync(path.join(PDF_CORE_TEST_DIRECTORY, folder, name));
}

/** 화면 방향 pt 사각형(쪽 `view_box` 왼쪽 아래 원점, y 위로) */
interface DisplayBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

interface GoldenEnd {
  bounds: TextBox;
  isAnchor: boolean;
  /** 줄 표시: 쪽 너비 전체 × 끝 사각형의 세로 범위(화면 방향 pt) */
  row: DisplayBox;
}

interface GoldenConnector {
  changeId: string;
  kind: Change["kind"];
  shape: "line" | "band";
  before: GoldenEnd;
  after: GoldenEnd;
}

interface ConnectorsGolden {
  pagePairs: CompareResult["pagePairs"];
  pageSizes: CompareResult["pageSizes"];
  connectors: GoldenConnector[];
}

const CHANGES = JSON.parse(
  readCore("golden", "connector-geometry.changes.json").toString("utf8")
) as Change[];
const GOLDEN = JSON.parse(
  readCore("golden", "connector-geometry.connectors.json").toString("utf8")
) as ConnectorsGolden;
const BEFORE_BYTES = readCore("fixtures", "connector-geometry-a.pdf").toString(
  "base64"
);
const AFTER_BYTES = readCore("fixtures", "connector-geometry-b.pdf").toString(
  "base64"
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
  "connector-geometry-a.pdf",
  BEFORE_BYTES,
  GOLDEN.pageSizes.before
);
const AFTER_FILE = seedFile(
  "connector-geometry-b.pdf",
  AFTER_BYTES,
  GOLDEN.pageSizes.after
);

function textLayer(count: number): TextSource[] {
  return Array.from({ length: count }, () => "textLayer");
}

function geometryResult(changes: Change[] = CHANGES): CompareResult {
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
    result = geometryResult()
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
  const card = page.getByRole("button", { name: "PDF 비교", exact: true });
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

/** 문서 하나의 패널 이름("A 문서"·"B 문서") */
function paneName(badge: string): string {
  return `${badge} 문서`;
}

const PANE_A = paneName("A");

function pane(page: Page, badge: string): Locator {
  return pageArea(page).getByRole("group", { name: paneName(badge) });
}

function paneScroller(page: Page, badge: string): Locator {
  return pane(page, badge).locator("[data-virtuoso-scroller]");
}

function changeItem(page: Page, number: number): Locator {
  return page
    .getByRole("complementary", { name: "차이 목록" })
    .getByRole("button", { name: new RegExp(`^#${number} `) });
}

function connectorToggle(page: Page): Locator {
  return page.getByRole("checkbox", { name: "연결선" });
}

function syncToggle(page: Page): Locator {
  return page.getByRole("checkbox", { name: "동기 스크롤" });
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

function overlay(page: Page): Locator {
  return pageArea(page).locator("[data-connector-layer]");
}

function connector(page: Page, changeId: string): Locator {
  return overlay(page).locator(`g[data-change-id="${changeId}"]`);
}

/** 쪽 위 연결선 끝의 줄 표시 */
function rowBand(page: Page, changeId: string, side: string): Locator {
  return pageArea(page).locator(
    `path[data-row-band][data-change-id="${changeId}"][data-side="${side}"]`
  );
}

function changeNumber(id: string): number {
  return CHANGES.findIndex((change) => change.id === id) + 1;
}

interface Point {
  x: number;
  y: number;
}

/** path `d`(M·H·V·L·C·Z)가 지나는 점들. 베지어는 끝점만 */
function pathPoints(d: string): Point[] {
  const tokens = d.match(/[MHVLCZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  let index = 0;
  const next = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "M" || command === "L") {
      current = { x: next(), y: next() };
    } else if (command === "H") {
      current = { ...current, x: next() };
    } else if (command === "V") {
      current = { ...current, y: next() };
    } else if (command === "C") {
      index += 4;
      current = { x: next(), y: next() };
    } else {
      continue;
    }
    points.push(current);
  }
  return points;
}

/** 쪽의 화면 방향 크기(pt): 90·270도는 `view_box`의 너비·높이가 바뀐다. */
function displaySizeOf({ viewBox, rotation }: PageSize) {
  const width = viewBox.right - viewBox.left;
  const height = viewBox.top - viewBox.bottom;
  const isQuarterTurn = rotation % HALF_TURN !== 0;
  return {
    width: isQuarterTurn ? height : width,
    height: isQuarterTurn ? width : height
  };
}

/** 쪽 위에 놓인 줄 표시의 기대 자리(px, 화면 좌표)와 연결선이 나가는 x */
interface ExpectedRow {
  left: number;
  right: number;
  top: number;
  bottom: number;
  exitX: number;
}

interface ExpectedRowParams {
  end: GoldenEnd;
  size: PageSize;
  isBefore: boolean;
  /** 쪽 그림이 화면에 놓인 자리 */
  image: { x: number; y: number; width: number };
}

/**
 * golden 줄 표시(화면 방향 pt, y 위로)를 쪽 그림 너비의 배율로 화면에 놓는다. 연결선은 줄 표시의 거터를
 * 향한 변(A 오른쪽, B 왼쪽)에서 나간다.
 */
function expectedRow({
  end,
  size,
  isBefore,
  image
}: ExpectedRowParams): ExpectedRow {
  const display = displaySizeOf(size);
  const ratio = image.width / display.width;
  const left = image.x + end.row.left * ratio;
  const right = image.x + end.row.right * ratio;
  return {
    left,
    right,
    top: image.y + (display.height - end.row.top) * ratio,
    bottom: image.y + (display.height - end.row.bottom) * ratio,
    exitX: isBefore ? right : left
  };
}

/**
 * 연결선 하나가 보이고(`shown`), 모양이 golden과 같고, 두 쪽의 줄 표시와 그린 경로의 두 끝이 golden 줄
 * 표시를 화면에 놓은 자리와 1px 안이다. 선은 시작점 = A 줄 표시 오른쪽 끝 세로 가운데, 끝점 = B 줄 표시 왼쪽
 * 끝 세로 가운데이고, 띠는 A 줄 표시 위 변 → B 위·아래 변 → A 아래 변이다.
 */
async function expectConnectorMatchesGolden(
  page: Page,
  golden: GoldenConnector
): Promise<void> {
  const group = connector(page, golden.changeId);
  await expect(group).toHaveAttribute("data-shape", golden.shape);
  // 고른 변경으로 스크롤하는 중일 수 있어 자리가 멈출 때까지 다시 잰다.
  await expect(() => measureConnectorAgainstGolden(page, golden)).toPass();
}

/**
 * SVG 도형의 화면 사각형(테두리 굵기를 빼고 경로만). `boundingBox`는 WebKit에서 선 굵기를 더해 잰다.
 */
async function geometryBox(
  shape: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
  return shape.evaluate((element) => {
    if (!(element instanceof SVGGraphicsElement)) {
      throw new Error("SVG 도형이 아닙니다.");
    }
    const box = element.getBBox();
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error("SVG 변환이 없습니다.");
    const start = new DOMPoint(box.x, box.y).matrixTransform(matrix);
    const end = new DOMPoint(
      box.x + box.width,
      box.y + box.height
    ).matrixTransform(matrix);
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    };
  });
}

function expectNear(actual: number, expected: number, message: string): void {
  expect(Math.abs(actual - expected), message).toBeLessThanOrEqual(
    ENDPOINT_TOLERANCE_PX
  );
}

async function measureConnectorAgainstGolden(
  page: Page,
  golden: GoldenConnector
): Promise<void> {
  const group = connector(page, golden.changeId);
  expect(await group.getAttribute("data-state"), golden.changeId).toBe("shown");
  const beforeImage = pane(page, "A").getByRole("img", {
    name: `A ${golden.before.bounds.page + 1}쪽`
  });
  const afterImage = pane(page, "B").getByRole("img", {
    name: `B ${golden.after.bounds.page + 1}쪽`
  });
  const rowBand = (image: Locator) =>
    image.locator(`path[data-row-band][data-change-id="${golden.changeId}"]`);
  const [layerBox, beforeBox, afterBox, beforeBandBox, afterBandBox] =
    await Promise.all([
      overlay(page).boundingBox(),
      beforeImage.boundingBox(),
      afterImage.boundingBox(),
      geometryBox(rowBand(beforeImage)),
      geometryBox(rowBand(afterImage))
    ]);
  if (!layerBox || !beforeBox || !afterBox || !beforeBandBox || !afterBandBox) {
    throw new Error(
      `${golden.changeId}: 연결선·쪽 그림·줄 표시가 화면에 없습니다.`
    );
  }
  const before = expectedRow({
    end: golden.before,
    size: GOLDEN.pageSizes.before[golden.before.bounds.page],
    isBefore: true,
    image: beforeBox
  });
  const after = expectedRow({
    end: golden.after,
    size: GOLDEN.pageSizes.after[golden.after.bounds.page],
    isBefore: false,
    image: afterBox
  });
  const part = golden.shape === "band" ? "band" : "line";
  const d =
    (await group.locator(`path[data-part="${part}"]`).getAttribute("d")) ?? "";
  const message = `${golden.changeId}(${golden.kind} ${golden.shape}): ${d}`;
  for (const [band, row] of [
    [beforeBandBox, before],
    [afterBandBox, after]
  ] as const) {
    expectNear(band.x, row.left, `${message} 줄 표시 왼쪽`);
    expectNear(band.x + band.width, row.right, `${message} 줄 표시 오른쪽`);
    expectNear(band.y, row.top, `${message} 줄 표시 위`);
    expectNear(band.y + band.height, row.bottom, `${message} 줄 표시 아래`);
  }
  const points = pathPoints(d).map(({ x, y }) => ({
    x: layerBox.x + x,
    y: layerBox.y + y
  }));
  const expected: Point[] =
    golden.shape === "band"
      ? [
          { x: before.exitX, y: before.top },
          { x: after.exitX, y: after.top },
          { x: after.exitX, y: after.bottom },
          { x: before.exitX, y: before.bottom }
        ]
      : [
          { x: before.exitX, y: (before.top + before.bottom) / 2 },
          { x: after.exitX, y: (after.top + after.bottom) / 2 }
        ];
  const actual =
    golden.shape === "band"
      ? [points[0], points[3], points[4], points[7]]
      : [points[0], points[points.length - 1]];
  for (const [index, point] of expected.entries()) {
    expectNear(actual[index].x, point.x, message);
    expectNear(actual[index].y, point.y, message);
  }
}

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

/** 변경을 목록에서 골라(두 패널이 그 자리로 간다) 줄 표시·연결선을 golden과 맞댄다. */
async function expectAllConnectorsMatchGolden(page: Page): Promise<void> {
  for (const golden of GOLDEN.connectors) {
    await changeItem(page, changeNumber(golden.changeId)).click();
    await expectConnectorMatchesGolden(page, golden);
  }
}

test("화면 줄 표시·끝점·모양이 Rust golden과 1px 안이다(회전 0·90·180·270·CropBox·MediaBox 원점, 한 줄·두 줄·여러 쪽·앵커·띠), 배율·창 크기를 바꿔도 같다", async ({
  page
}) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openResult(page);
  await expect(connectorToggle(page)).toBeChecked();
  await expect(statusBar(page)).toContainText(
    `연결선 ${GOLDEN.connectors.length}개`
  );
  expect(new Set(GOLDEN.connectors.map(({ shape }) => shape))).toEqual(
    new Set(["line", "band"])
  );

  await expectAllConnectorsMatchGolden(page);

  await zoomTo(page, 50);
  await expectAllConnectorsMatchGolden(page);

  // 맞춤 배율은 창 너비를 따라간다.
  await page.getByRole("button", { name: "맞춤" }).click();
  const zoomLevel = page.getByRole("status", { name: "배율" });
  const widePercent = (await zoomLevel.textContent()) ?? "";
  await page.setViewportSize(VIEWPORT);
  await expect(zoomLevel).not.toHaveText(widePercent);
  await expectAllConnectorsMatchGolden(page);
});

interface PureCaseArgs {
  pdfjsSetupModule: string;
  pageGeometryModule: string;
  connectorGeometryModule: string;
  pdfBase64: string;
}

interface PureCaseResult {
  pageIndex: number;
  scale: number;
  /** 모듈의 변환(배율 1 viewport + 비율 + 쪽 자리 − 스크롤 + 패널 자리) */
  actual: { left: number; top: number; right: number; bottom: number };
  /** 그 배율의 pdf.js viewport로 바로 바꾼 사각형 + 같은 자리 이동 */
  expected: { left: number; top: number; right: number; bottom: number };
}

/**
 * 브라우저에서 돈다. 좌표 변환 파이프라인(`toContentRect` → `toOverlayRect`)을 4쪽(회전 0+CropBox, 90+CropBox,
 * 180, 270+MediaBox 원점)·배율 0.5/1/2에서 부르고, 같은 쪽을 그 배율의 pdf.js viewport로 바로 바꾼 값과 함께
 * 돌려준다. 쪽 자리·스크롤·패널 자리는 일부러 0이 아닌 값이다.
 */
async function transformCases({
  pdfjsSetupModule,
  pageGeometryModule,
  connectorGeometryModule,
  pdfBase64
}: PureCaseArgs): Promise<PureCaseResult[]> {
  const {
    openPdfDocument
  }: typeof import("../src/renderer/shared/lib/pdfjs/pdfjs-setup") =
    await import(pdfjsSetupModule);
  const {
    toPageGeometry
  }: typeof import("../src/renderer/shared/lib/pdfjs/page-geometry") =
    await import(pageGeometryModule);
  const {
    toContentRect,
    toOverlayRect
  }: typeof import("../src/renderer/widgets/compare-viewer/lib/connector-geometry") =
    await import(connectorGeometryModule);
  const pageLeft = 37;
  const pageTop = 1210;
  const pane = { left: 412, top: 9, scrollLeft: 15, scrollTop: 1100 };
  const bytes = Uint8Array.from(atob(pdfBase64), (character) =>
    character.charCodeAt(0)
  );
  const loadingTask = openPdfDocument(bytes);
  try {
    const document = await loadingTask.promise;
    const results: PureCaseResult[] = [];
    for (const pageIndex of [0, 1, 2, 3]) {
      const pdfPage = await document.getPage(pageIndex + 1);
      const geometry = toPageGeometry(pdfPage.getViewport({ scale: 1 }));
      const view = pdfPage.view;
      const bounds = {
        page: pageIndex,
        x: view[0] + 50,
        y: view[1] + 120,
        w: 80,
        h: 12
      };
      for (const scale of [0.5, 1, 2]) {
        const viewport = pdfPage.getViewport({ scale });
        const content = toContentRect({
          geometry,
          bounds,
          page: {
            left: pageLeft,
            top: pageTop,
            widthPx: viewport.width,
            heightPx: viewport.height
          }
        });
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
          bounds.x,
          bounds.y,
          bounds.x + bounds.w,
          bounds.y + bounds.h
        ]);
        const dx = pageLeft - pane.scrollLeft + pane.left;
        const dy = pageTop - pane.scrollTop + pane.top;
        results.push({
          pageIndex,
          scale,
          actual: toOverlayRect({ rect: content, pane }),
          expected: {
            left: Math.min(x1, x2) + dx,
            top: Math.min(y1, y2) + dy,
            right: Math.max(x1, x2) + dx,
            bottom: Math.max(y1, y2) + dy
          }
        });
      }
    }
    return results;
  } finally {
    await loadingTask.destroy();
  }
}

/** 브라우저에서 돈다. 경로·컬링 순수 함수를 손으로 정한 입력으로 부른다. */
async function pathAndCullCases(connectorGeometryModule: string) {
  const {
    bandPath,
    connectorPath,
    cullConnector,
    endSpanOf
  }: typeof import("../src/renderer/widgets/compare-viewer/lib/connector-geometry") =
    await import(connectorGeometryModule);
  const gutter = { left: 100, right: 220 };
  const endRect = { left: 40, top: 10, right: 90, bottom: 22 };
  const pageSpan = { left: 16, right: 316 };
  const view = { top: 0, bottom: 100 };
  const span = (top: number, bottom: number) => ({ x: 0, top, bottom });
  return {
    // 연결선은 줄 표시의 거터 쪽 변(쪽 끝)에서 나간다: A는 쪽 오른쪽, B는 쪽 왼쪽. 세로는 끝 사각형 범위
    beforeSpan: endSpanOf({ rect: endRect, page: pageSpan, side: "before" }),
    afterSpan: endSpanOf({ rect: endRect, page: pageSpan, side: "after" }),
    line: connectorPath({
      start: { x: 10, y: 20 },
      end: { x: 300, y: 60 },
      gutter
    }),
    band: bandPath({
      before: { x: 40, top: 10, bottom: 70 },
      after: { x: 250, top: 30, bottom: 30 },
      gutter
    }),
    // A 끝이 화면 아래 경계에 정확히 닿는다(보인다), B 끝은 화면 위
    edgeTouching: cullConnector({
      ends: { before: span(100, 110), after: span(-20, -10) },
      views: { before: view, after: view }
    }),
    // A 끝이 경계에서 0.01px 아래, B 끝은 화면 위: 둘 다 밖
    bothOutside: cullConnector({
      ends: { before: span(100.01, 110), after: span(-20, -10) },
      views: { before: view, after: view }
    }),
    // 띠 끝이 화면 위에서 걸쳐 내려온다(가운데는 밖이어도 보인다)
    bandStraddling: cullConnector({
      ends: { before: span(-50, 5), after: span(40, 60) },
      views: { before: view, after: view }
    }),
    // B 끝만 화면 아래
    afterBelow: cullConnector({
      ends: { before: span(40, 60), after: span(130, 140) },
      views: { before: view, after: view }
    })
  };
}

test("순수 함수: 좌표 변환(회전 0/90/180/270·배율 0.5/1/2·CropBox·MediaBox 원점), 연결선이 나가는 점, 경로 끝점, 컬링 경계값", async ({
  page
}) => {
  await page.goto("/");
  const transforms = await page.evaluate(transformCases, {
    pdfjsSetupModule: PDFJS_SETUP_MODULE,
    pageGeometryModule: PAGE_GEOMETRY_MODULE,
    connectorGeometryModule: CONNECTOR_GEOMETRY_MODULE,
    pdfBase64: BEFORE_BYTES
  });
  expect(transforms).toHaveLength(12);
  for (const { pageIndex, scale, actual, expected } of transforms) {
    for (const key of ["left", "top", "right", "bottom"] as const) {
      expect(
        Math.abs(actual[key] - expected[key]),
        `${pageIndex}쪽 배율 ${scale} ${key}`
      ).toBeLessThan(0.01);
    }
  }

  const cases = await page.evaluate(
    pathAndCullCases,
    CONNECTOR_GEOMETRY_MODULE
  );
  expect(cases.beforeSpan).toEqual({ x: 316, top: 10, bottom: 22 });
  expect(cases.afterSpan).toEqual({ x: 16, top: 10, bottom: 22 });
  // 수평(10 → 100) + 거터 베지어(제어점 x = 100 + 60, 220 − 60) + 수평(220 → 300)
  expect(cases.line).toBe("M10 20 H100 C160 20 160 60 220 60 H300");
  // 위 변 A(40, 10) → B(250, 30), B를 내려와(높이 0인 앵커 변) 아래 변 → A(40, 70)
  expect(cases.band).toBe(
    "M40 10 H100 C160 10 160 30 220 30 H250 V30 H220 C160 30 160 70 100 70 H40 Z"
  );
  expect(cases.edgeTouching).toEqual({
    state: "clamped",
    side: "after",
    edge: "top"
  });
  expect(cases.bothOutside).toEqual({ state: "hidden" });
  expect(cases.bandStraddling).toEqual({ state: "shown" });
  expect(cases.afterBelow).toEqual({
    state: "clamped",
    side: "after",
    edge: "bottom"
  });
});

/** 두 패널의 첫 쪽 그림을 받을 때까지 기다린다(패널을 만들고 스크롤 처리를 붙인 뒤다). */
async function expectPanesSettled(page: Page): Promise<void> {
  for (const badge of ["A", "B"]) {
    await expect(
      pane(page, badge).getByRole("img", { name: `${badge} 1쪽` })
    ).toHaveAttribute("aria-busy", "false");
  }
}

/**
 * 앱 행 배치를 따르지 않고 화면에서 잰 한 행 높이(A 1쪽 · B 1쪽 행). 빠르게 스크롤한 직후에는 virtuoso가
 * 행을 자리표시(scroll seek)로 바꿨다가 속도가 가라앉으면 되돌린다. 그 사이 행이 없거나 찾은 순간 떼어져
 * `boundingBox`가 `null`이므로, 행이 다시 그려질 때까지 기다려 잰다.
 */
async function rowHeight(page: Page): Promise<number> {
  const row = pane(page, "B").getByRole("group", { name: "A 1쪽 · B 1쪽" });
  let height = 0;
  await expect(async () => {
    const box = await row.boundingBox();
    expect(box, "첫 행이 화면에 없습니다.").not.toBeNull();
    height = box?.height ?? 0;
  }).toPass();
  return height;
}

async function scrollPane(page: Page, badge: string, top: number) {
  await paneScroller(page, badge).evaluate((element, value) => {
    element.scrollTop = value;
  }, top);
}

async function scrollTopOf(page: Page, badge: string): Promise<number> {
  return paneScroller(page, badge).evaluate((element) => element.scrollTop);
}

const [FIRST_CONNECTOR] = GOLDEN.connectors;
/** 마지막 쪽(4쪽)의 연결선 */
const LAST_PAGE_CONNECTOR = GOLDEN.connectors[GOLDEN.connectors.length - 1];

test("동기 스크롤을 끄고 B만 내리면 위로 나간 B 끝은 패널 위 경계로 끌려온 점선이 되고, 둘 다 밖이면 그리지 않으며, 누르면 B가 그 변경으로 돌아온다", async ({
  page
}) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openResult(page);
  await expectPanesSettled(page);
  await syncToggle(page).click();
  await expect(syncToggle(page)).not.toBeChecked();
  const first = connector(page, FIRST_CONNECTOR.changeId);
  await expect(first).toHaveAttribute("data-state", "shown");

  // B만 한 행 내린다: 1쪽 B 끝은 화면 위, A 끝은 그대로 보인다.
  const firstRowHeight = await rowHeight(page);
  await scrollPane(page, "A", 0);
  await scrollPane(page, "B", firstRowHeight);
  await expect(first).toHaveAttribute("data-state", "clamped");
  await expect(first).toHaveAttribute("data-clamped-side", "after");
  await expect(first).toHaveAttribute("data-clamp-edge", "top");
  await expect(first.locator("path[data-part=line]")).toHaveAttribute(
    "stroke-dasharray",
    /\d/
  );
  await expect(first.locator("path[data-part=marker]")).toHaveAttribute(
    "d",
    /^M/
  );
  const [layerBox, paneBox] = await Promise.all([
    overlay(page).boundingBox(),
    pane(page, "B").boundingBox()
  ]);
  const d =
    (await first.locator("path[data-part=line]").getAttribute("d")) ?? "";
  const clampedPoints = pathPoints(d);
  const clampedEnd = clampedPoints[clampedPoints.length - 1];
  if (!layerBox || !paneBox || !clampedEnd) {
    throw new Error("연결선이나 패널이 화면에 없습니다.");
  }
  expect(layerBox.y + clampedEnd.y).toBeCloseTo(paneBox.y + CLAMP_INSET_PX, 0);
  // 4쪽 연결선: A 끝은 화면 아래(A는 맨 위), B 끝도 화면 아래(B는 한 행만 내렸다)
  await expect(connector(page, LAST_PAGE_CONNECTOR.changeId)).toHaveAttribute(
    "data-state",
    "hidden"
  );

  // 점선을 누르면 그 변경을 고르고 B 패널이 그 끝으로 돌아온다(A는 맨 위 그대로 보인다). 화면 밖 끝이
  // 같은 경계로 모인 다른 점선과 겹치지 않는 A 쪽 시작점(거터 왼쪽 끝)을 누른다.
  const hitD =
    (await first.locator("path[data-part=hit]").getAttribute("d")) ?? "";
  const [hitStart] = pathPoints(hitD);
  await page.mouse.click(layerBox.x + hitStart.x + 2, layerBox.y + hitStart.y);
  await expect(changeItem(page, 1)).toHaveAttribute("aria-current", "true");
  await expect(first).toHaveAttribute("data-state", "shown");
  expect(await scrollTopOf(page, "B")).toBeLessThan(firstRowHeight);
  // 동기 스크롤이 꺼져 있으므로 두 패널은 따로다.
  await scrollPane(page, "B", 40);
  await expect.poll(() => scrollTopOf(page, "B")).toBe(40);
  expect(await scrollTopOf(page, "A")).not.toBe(40);
});

test("동기 스크롤(기본 켬)은 두 패널을 같은 위치로 두고, 끄면 따로 스크롤하며, 다시 켜면 B를 A에 맞춘다", async ({
  page
}) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openResult(page);
  await expectPanesSettled(page);
  await expect(syncToggle(page)).toBeChecked();

  await scrollPane(page, "A", 300);
  await expect.poll(() => scrollTopOf(page, "B")).toBe(300);
  await scrollPane(page, "B", 120);
  await expect.poll(() => scrollTopOf(page, "A")).toBe(120);

  await syncToggle(page).click();
  await scrollPane(page, "A", 500);
  await expect.poll(() => scrollTopOf(page, "A")).toBe(500);
  expect(await scrollTopOf(page, "B")).toBe(120);

  await syncToggle(page).click();
  await expect.poll(() => scrollTopOf(page, "B")).toBe(500);

  // 패널이 하나인 보기에서는 토글을 막는다.
  await page
    .getByRole("group", { name: "보기 방식" })
    .getByRole("button", { name: "A만" })
    .click();
  await expect(syncToggle(page)).toBeDisabled();
});

test("연결선을 가리키면 굵어지고 양쪽 상자·줄 표시·목록 항목을 함께 강조하며, 누르면 그 변경을 고른다", async ({
  page
}) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openResult(page);
  const band = GOLDEN.connectors.find(({ shape }) => shape === "band");
  if (!band) throw new Error("golden에 띠가 없습니다.");
  const target = connector(page, band.changeId);
  await expect(target).toHaveAttribute("data-state", "shown");
  const outline = target.locator("path[data-part=band]");
  const bandStroke = await outline.getAttribute("stroke-width");

  await target.locator("path[data-part=hit]").hover();
  await expect(target).toHaveAttribute("data-emphasized", "true");
  await expect(outline).not.toHaveAttribute("stroke-width", bandStroke ?? "");
  const number = changeNumber(band.changeId);
  await expect(changeItem(page, number)).toHaveAttribute(
    "data-hovered",
    "true"
  );
  for (const side of ["before", "after"]) {
    await expect(
      pageArea(page)
        .locator(`rect[data-change-id="${band.changeId}"][data-side="${side}"]`)
        .first()
    ).toHaveAttribute("data-hovered", "true");
    const row = rowBand(page, band.changeId, side);
    await expect(row).toHaveAttribute("data-emphasized", "true");
    await expect(row).toHaveAttribute("stroke-width", ROW_STROKE_EMPHASIZED);
  }
  // 다른 변경은 강조하지 않는다.
  await expect(changeItem(page, 1)).not.toHaveAttribute("data-hovered", "true");

  await page.mouse.move(1, VIEWPORT.height / 2);
  await expect(target).not.toHaveAttribute("data-emphasized", "true");
  await expect(rowBand(page, band.changeId, "after")).toHaveAttribute(
    "stroke-width",
    ROW_STROKE_NORMAL
  );
  await expect(changeItem(page, number)).not.toHaveAttribute(
    "data-hovered",
    "true"
  );

  // 선 연결선을 누르면 그 변경을 고르고 그 선이 강조된다.
  const line = connector(page, FIRST_CONNECTOR.changeId);
  await changeItem(page, number).click();
  await expect(line.locator("path[data-part=line]")).toHaveAttribute(
    "stroke-width",
    STROKE_NORMAL
  );
  await line.locator("path[data-part=hit]").click();
  await expect(changeItem(page, 1)).toHaveAttribute("aria-current", "true");
  await expect(line).toHaveAttribute("data-emphasized", "true");
  await expect(line.locator("path[data-part=line]")).toHaveAttribute(
    "stroke-width",
    STROKE_EMPHASIZED
  );
  await expect(line.locator("path[data-part=line]")).toHaveClass(
    /stroke-diff-change/
  );
});

test("연결선 체크박스·A만/B만·숨긴 종류는 연결선·줄 표시와 상태바 개수를 바꾼다", async ({
  page
}) => {
  await openResult(page);
  const groups = overlay(page).locator("g[data-change-id]");
  const firstRows = pageArea(page).locator(
    `path[data-row-band][data-change-id="${FIRST_CONNECTOR.changeId}"]`
  );
  await expect(groups).toHaveCount(GOLDEN.connectors.length);
  await expect(firstRows).toHaveCount(2);
  // 줄 표시는 같은 SVG에서 변경 상자보다 먼저 그린다(상자가 그 위에 보인다).
  for (const side of ["before", "after"]) {
    const isRowFirst = await rowBand(
      page,
      FIRST_CONNECTOR.changeId,
      side
    ).evaluate((row, changeId) => {
      const box = row
        .closest("svg")
        ?.querySelector(`rect[data-change-id="${changeId}"]`);
      return Boolean(
        box &&
        row.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    }, FIRST_CONNECTOR.changeId);
    expect(isRowFirst, side).toBe(true);
  }

  await connectorToggle(page).click();
  await expect(connectorToggle(page)).not.toBeChecked();
  await expect(overlay(page)).toHaveCount(0);
  await expect(statusBar(page)).not.toContainText("연결선");
  // 줄 표시는 연결선과 함께 숨고, 하이라이트는 그대로다(연결선과 별개).
  await expect(pageArea(page).locator("path[data-row-band]")).toHaveCount(0);
  await expect(
    pageArea(page).locator(`rect[data-change-id="${FIRST_CONNECTOR.changeId}"]`)
  ).toHaveCount(2);
  await connectorToggle(page).click();
  await expect(groups).toHaveCount(GOLDEN.connectors.length);
  await expect(firstRows).toHaveCount(2);

  const viewMode = page.getByRole("group", { name: "보기 방식" });
  for (const mode of ["A만", "B만"]) {
    await viewMode.getByRole("button", { name: mode }).click();
    await expect(overlay(page)).toHaveCount(0);
    await expect(pageArea(page).locator("path[data-row-band]")).toHaveCount(0);
    await expect(connectorToggle(page)).toBeDisabled();
    await expect(statusBar(page)).not.toContainText("연결선");
  }
  await viewMode.getByRole("button", { name: "나란히" }).click();
  await expect(groups).toHaveCount(GOLDEN.connectors.length);

  // 변경(`Replace`)을 숨기면 추가·삭제(앵커에 잇는다)만 남는다.
  await page
    .getByRole("group", { name: "차이 종류" })
    .getByRole("button", { name: /^변경 / })
    .click();
  const anchored = GOLDEN.connectors.filter(({ kind }) => kind !== "replace");
  await expect(groups).toHaveCount(anchored.length);
  await expect(statusBar(page)).toContainText(`연결선 ${anchored.length}개`);
});

test("다른 행에 걸친 변경도 잇고(동기 스크롤이면 기울어진 선), 상자가 없는 쪽의 앵커에도 줄 표시를 그리며, 끝의 쪽이 문서에 없는 앵커는 잇지 않는다", async ({
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
  /** A 2쪽(행 A 2쪽 · B 2쪽)과 B 3쪽(B만 있는 다음 행)에 걸친 변경 */
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
  /** A에 없는 쪽(문서는 5쪽)에 놓인 앵커: 잇지 않는다 */
  const nowhere: Change = {
    id: "nowhere",
    kind: "insert",
    before: { kind: "anchor", page: 7, x: 0, y: 0, h: 0 },
    after: {
      kind: "boxes",
      text: "새 줄",
      boxes: [box(0)],
      minConfidence: null
    },
    pagePair: [null, 0],
    needsReview: false
  };
  /** A 1쪽에는 상자가 하나도 없고 이 앵커만 있다: 줄 표시만으로 쪽 위 SVG를 그린다 */
  const anchorOnly: Change = {
    id: "anchor-only",
    kind: "insert",
    before: { kind: "anchor", page: 0, x: 60, y: 700, h: 12 },
    after: {
      kind: "boxes",
      text: "끼운 말",
      boxes: [box(0)],
      minConfidence: null
    },
    pagePair: [null, 0],
    needsReview: false
  };
  await openResult(page, {
    files: [
      seedFile("pages-base.pdf", base, sizes(5)),
      seedFile("pages-insert.pdf", inserted, sizes(6))
    ],
    result: {
      changes: [nowhere, crossRow, anchorOnly],
      pagePairs,
      pageSizes: { before: sizes(5), after: sizes(6) },
      pageSources: { before: textLayer(5), after: textLayer(6) },
      notices: []
    }
  });

  await expect(statusBar(page)).toContainText("연결선 2개");
  await expect(connector(page, "nowhere")).toHaveCount(0);
  await expect(rowBand(page, anchorOnly.id, "before")).toHaveCount(1);
  await expect(
    pane(page, "A").locator(`rect[data-change-id="${anchorOnly.id}"]`)
  ).toHaveCount(0);
  const firstRowHeight = await rowHeight(page);
  await changeItem(page, 2).click();
  const cross = connector(page, crossRow.id);
  await expect(cross).toHaveAttribute("data-state", "shown");
  const d =
    (await cross.locator("path[data-part=line]").getAttribute("d")) ?? "";
  const points = pathPoints(d);
  const rise = Math.abs(points[0].y - points[points.length - 1].y);
  // 두 끝이 한 행만큼 어긋난다(같은 쪽 자리 + 행 높이).
  expect(rise).toBeCloseTo(firstRowHeight, 0);
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
  const beforePage = pane(page, "A").getByRole("img", { name: "A 1쪽" });
  const taggedOnPage = CHANGES.filter(
    (change) =>
      change.before.kind === "boxes" &&
      change.before.boxes.some((box) => box.page === 0)
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

const MANY_PAGES = 20;
const CHANGES_PER_PAGE = 10;
const LINE_PITCH_PT = 60;
/**
 * 측정할 스크롤 프레임 수와 프레임마다 내리는 거리(px). 초당 720px라 virtuoso scroll seek(600px/s)에
 * 들어가 쪽은 자리만 두지만 연결선은 계속 그린다.
 */
const MEASURED_FRAMES = 240;
const SCROLL_STEP_PX = 12;
/** 스크롤 프레임 중 연결선이 다시 그려져야 하는 비율(첫 프레임·끝 프레임 여유) */
const REDRAWN_FRAME_RATIO = 0.9;

/** 브라우저에서 돈다. rAF마다 A 패널을 조금씩 내리며(동기 스크롤로 B도) 프레임 간격과 연결선 모양 변화를 잰다. */
interface MeasureScrollFramesArgs {
  /** 스크롤할 패널의 스크롤 컨테이너 선택자 */
  scrollerSelector: string;
  frames: number;
  step: number;
}

async function measureScrollFrames({
  scrollerSelector,
  frames,
  step
}: MeasureScrollFramesArgs) {
  const scroller = document.querySelector<HTMLElement>(scrollerSelector);
  if (!scroller) throw new Error("A 패널이 없습니다.");
  const shownPaths = () =>
    [
      ...document.querySelectorAll<SVGGElement>(
        "[data-connector-layer] g[data-state=shown]"
      )
    ].map(
      (group) =>
        group.querySelector("[data-part=line]")?.getAttribute("d") ?? ""
    );
  const intervals: number[] = [];
  const shownCounts: number[] = [];
  let changedFrames = 0;
  let previousPaths = shownPaths();
  await new Promise<void>((resolve) => {
    let last = performance.now();
    let count = 0;
    const tick = (now: number) => {
      intervals.push(now - last);
      last = now;
      const paths = shownPaths();
      shownCounts.push(paths.length);
      if (paths.join("|") !== previousPaths.join("|")) changedFrames += 1;
      previousPaths = paths;
      scroller.scrollTop += step;
      count += 1;
      if (count < frames) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
  const sorted = [...intervals.slice(1)].sort(
    (first, second) => first - second
  );
  const at = (ratio: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  return {
    medianMs: at(0.5),
    p95Ms: at(0.95),
    maxMs: sorted[sorted.length - 1],
    maxShown: Math.max(...shownCounts),
    changedFrames
  };
}

test("연결선 200개: 스크롤하는 동안 프레임마다 연결선이 따라오고 프레임 시간을 잰다", async ({
  page
}, testInfo) => {
  const bytesBase64 = readFileSync(
    path.join(E2E_FIXTURE_DIRECTORY, "hundred-pages.pdf")
  ).toString("base64");
  const a4: PageSize = {
    viewBox: { left: 0, bottom: 0, right: 595, top: 842 },
    rotation: 0
  };
  const sizes = Array.from({ length: MANY_PAGES }, () => a4);
  const side = (pageIndex: number, line: number, x: number) => ({
    kind: "boxes" as const,
    text: `${pageIndex}-${line}`,
    boxes: [
      { page: pageIndex, x, y: 760 - line * LINE_PITCH_PT, w: 80, h: 12 }
    ],
    minConfidence: null
  });
  const changes: Change[] = sizes.flatMap((_size, pageIndex) =>
    Array.from({ length: CHANGES_PER_PAGE }, (_value, line) => ({
      id: `many-${pageIndex}-${line}`,
      kind: "replace" as const,
      before: side(pageIndex, line, 80),
      after: side(pageIndex, line, 300),
      pagePair: [pageIndex, pageIndex] as [number, number],
      needsReview: false
    }))
  );
  await openResult(page, {
    files: [
      seedFile("many-a.pdf", bytesBase64, sizes),
      seedFile("many-b.pdf", bytesBase64, sizes)
    ],
    result: {
      changes,
      pagePairs: sizes.map((_size, index) => [index, index]),
      pageSizes: { before: sizes, after: sizes },
      pageSources: {
        before: textLayer(MANY_PAGES),
        after: textLayer(MANY_PAGES)
      },
      notices: []
    }
  });
  await expect(statusBar(page)).toContainText(`연결선 ${changes.length}개`);
  await expect(overlay(page).locator("g[data-change-id]")).toHaveCount(
    changes.length
  );
  await expect(
    overlay(page).locator("g[data-state=shown]").first()
  ).toBeAttached();

  const measured = await page.evaluate(measureScrollFrames, {
    scrollerSelector: `[aria-label="${PANE_A}"] [data-virtuoso-scroller]`,
    frames: MEASURED_FRAMES,
    step: SCROLL_STEP_PX
  });
  testInfo.annotations.push({
    type: "connector-scroll-frames",
    description: JSON.stringify(measured)
  });
  // 스크롤하는 동안(멈춘 뒤가 아니라) 거의 모든 프레임에서 보이는 연결선이 다시 그려진다.
  expect(measured.maxShown).toBeGreaterThan(0);
  expect(measured.changedFrames).toBeGreaterThan(
    MEASURED_FRAMES * REDRAWN_FRAME_RATIO
  );
});
