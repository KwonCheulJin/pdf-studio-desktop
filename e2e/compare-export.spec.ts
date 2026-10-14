import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type {
  Change,
  CompareReportOptions,
  CompareResult,
  PageSize,
  Placement,
  PreviewCompareReportRequest,
  TextSource
} from "../src/renderer/shared/api/bindings";

/**
 * 비교 결과 내보내기(계획서 P3-5, 진행 가이드 Step 29, 시안 5).
 * - 결과 머리 "내보내기"가 시안 5 모달(최대 1040px, `1fr | 360px`)을 연다.
 * - 받을 파일·비교 PDF 옵션·결과 화면 필터가 미리보기 요청과 내보내기 요청에 그대로 실린다.
 * - 미리보기는 첫 장부터 받은 장 안에서 넘기고, 늦게 온 앞 요청의 응답이 새 미리보기를 덮지 않는다.
 * - 바닥 줄 이유 문구와 막힘, 저장 위치(폴더 다이얼로그)·만들 파일 이름, 끝나면 토스트, 같은 이름이면 번호.
 * - 내보내는 중 취소하면 그 작업을 취소하고 알리지 않는다.
 *
 * 결과는 pages-base.pdf(A, 5쪽) ↔ pages-insert.pdf(B, 6쪽)와 Rust golden 쪽 짝(`pages-insert.page-pairs.json`:
 * `[0,0] [1,1] [–,2] [2,3] [3,4] [4,5]`)에 손으로 둔 변경 셋(A1·B1 변경, B3 추가, A4 삭제)이다. 장 수 기대값은
 * ADR 0001 §14 장 고르기 규칙으로 손으로 셌다. mock 미리보기·내보내기는 Rust처럼 장을 고르고(장마다 번호를
 * 쓴 PNG), 같은 이름이면 `이름 (2).pdf`로 만든다.
 */

const PDF_CORE_TEST_DIRECTORY = path.join(
  __dirname,
  "..",
  "crates",
  "pdf-core",
  "tests"
);
const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_PIXEL_RATIO = 2;
/** 시안 5: 모달 최대 너비와 오른쪽 미리보기 칸 너비(px) */
const DIALOG_MAX_WIDTH_PX = 1040;
const PREVIEW_COLUMN_WIDTH_PX = 360;
const LAYOUT_TOLERANCE_PX = 1;

test.use({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_PIXEL_RATIO });

function readCore(folder: string, name: string): Buffer {
  return readFileSync(path.join(PDF_CORE_TEST_DIRECTORY, folder, name));
}

const A4_SIZE: PageSize = {
  viewBox: { left: 0, bottom: 0, right: 595, top: 842 },
  rotation: 0
};

function a4Sizes(pageCount: number): PageSize[] {
  return Array.from({ length: pageCount }, () => A4_SIZE);
}

function textLayer(pageCount: number): TextSource[] {
  return Array.from({ length: pageCount }, () => "textLayer");
}

function seedFile(displayName: string, pageCount: number): E2eMockFile {
  return {
    path: `/Users/e2e/originals/${displayName}`,
    displayName,
    pages: a4Sizes(pageCount).map(({ viewBox, rotation }) => ({
      widthPt: viewBox.right - viewBox.left,
      heightPt: viewBox.top - viewBox.bottom,
      rotation,
      mediaBox: viewBox,
      cropBox: viewBox
    })),
    bytesBase64: readCore("fixtures", displayName).toString("base64")
  };
}

const BEFORE = seedFile("pages-base.pdf", 5);
const AFTER = seedFile("pages-insert.pdf", 6);
const EXPORT_DIRECTORY = "/Users/e2e/exports";
const OTHER_DIRECTORY = "/Users/e2e/reports";
/** 두 이름의 공통 머리("pages-")를 한 번만 쓴다. */
const COMPARE_FILE_NAME = "pages-base-insert_비교.pdf";
const ANNOTATED_FILE_NAME = "pages-base-insert_주석.pdf";

function side(page: number, text: string): Placement {
  return {
    kind: "boxes",
    text,
    boxes: [{ page, x: 72, y: 700, w: 160, h: 14 }],
    minConfidence: null
  };
}

/** 반대쪽에 글자가 없는 변경의 들어갈 자리(ADR 0001 §4). 상자가 없어 장 고르기에 들지 않는다. */
function anchor(page: number): Placement {
  return { kind: "anchor", page, x: 232, y: 700, h: 14 };
}

const CHANGES: Change[] = [
  {
    id: "replace-first-page",
    kind: "replace",
    before: side(0, "계약 기간 1년"),
    after: side(0, "계약 기간 2년"),
    pagePair: [0, 0],
    needsReview: false
  },
  {
    id: "insert-new-page",
    kind: "insert",
    before: anchor(1),
    after: side(2, "새 조항"),
    pagePair: [null, 2],
    needsReview: false
  },
  {
    id: "delete-on-fourth-page",
    kind: "delete",
    before: side(3, "지체상금"),
    after: anchor(4),
    pagePair: [3, null],
    needsReview: false
  }
];

const RESULT: CompareResult = {
  changes: CHANGES,
  pagePairs: JSON.parse(
    readCore("golden", "pages-insert.page-pairs.json").toString("utf8")
  ) as CompareResult["pagePairs"],
  pageSizes: { before: a4Sizes(5), after: a4Sizes(6) },
  pageSources: { before: textLayer(5), after: textLayer(6) },
  notices: []
};

interface OpenResultParams {
  directoryPicks?: (string | null)[];
}

/** 홈 비교 카드에 두 파일을 놓고 비교를 실행해 결과 화면을 연다. */
async function openResult(
  page: Page,
  { directoryPicks }: OpenResultParams = {}
): Promise<void> {
  const seed: E2eMockSeed = {
    files: [BEFORE, AFTER],
    compareScripts: [{ progress: [], result: RESULT }],
    directoryPicks
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
  const paths = [BEFORE.path, AFTER.path];
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
    page.getByRole("heading", { name: "pages-base.pdf → pages-insert.pdf" })
  ).toBeVisible();
}

/** 결과 화면 툴바의 종류 칩을 눌러 그 종류를 숨긴다. */
async function hideKind(page: Page, chipName: string): Promise<void> {
  const chip = page.getByRole("button", { name: chipName, exact: true });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
}

async function openExport(page: Page): Promise<Locator> {
  await page
    .locator("header")
    .getByRole("button", { name: "내보내기" })
    .click();
  const dialog = page.getByRole("dialog", { name: "PDF로 내보내기" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function previewPanel(dialog: Locator): Locator {
  return dialog.getByRole("region", { name: "미리보기" });
}

function exportButton(dialog: Locator): Locator {
  return dialog.getByRole("button", { name: "내보내기" });
}

function toast(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

async function lastPreviewOptions(page: Page): Promise<CompareReportOptions> {
  const previews = await page.evaluate(
    () => window.__E2E_MOCK_PREVIEWS__ ?? []
  );
  const last: PreviewCompareReportRequest | undefined =
    previews[previews.length - 1];
  if (!last) throw new Error("미리보기 요청이 없습니다.");
  return last.options;
}

async function readWrites(page: Page): Promise<E2eWriteCall[]> {
  return page.evaluate(() => window.__E2E_MOCK_WRITES__ ?? []);
}

test("내보내기는 시안 5 모달을 열고, 지금 필터대로 받은 미리보기를 첫 장부터 넘긴다", async ({
  page
}) => {
  await openResult(page);
  await hideKind(page, "삭제 1");
  const dialog = await openExport(page);

  // 여는 동안(확대 애니메이션) 상자가 작으므로 다 열린 크기를 기다린다.
  await expect
    .poll(async () => (await dialog.boundingBox())?.width)
    .toBeCloseTo(DIALOG_MAX_WIDTH_PX, 0);
  const panel = previewPanel(dialog);
  const panelBox = await panel.boundingBox();
  expect(
    Math.abs((panelBox?.width ?? 0) - PREVIEW_COLUMN_WIDTH_PX)
  ).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);

  // 시안 5 기본값: 비교 PDF · 나란히 · 차이 있는 쪽만 · 색 상자, 주석 PDF는 끔
  await expect(
    dialog.getByRole("checkbox", { name: "비교 PDF" })
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "주석 PDF" })
  ).not.toBeChecked();
  const layout = dialog.getByRole("group", { name: "쪽 구성" });
  await expect(
    layout.getByRole("button", { name: "A·B 나란히" })
  ).toHaveAttribute("aria-pressed", "true");
  const changedOnly = dialog.getByRole("checkbox", {
    name: "차이가 있는 쪽만 넣기"
  });
  const drawBoxes = dialog.getByRole("checkbox", {
    name: "차이 표시(색 상자) 넣기"
  });
  await expect(changedOnly).toBeChecked();
  await expect(drawBoxes).toBeChecked();

  // 삭제를 숨겼으므로 차이 있는 행은 A1·B1 변경과 B3 추가 두 행(전체 6행)
  await expect(dialog).toContainText("(6쪽 → 2쪽)");
  await expect(panel).toContainText("1 / 2장");
  await expect(panel).toContainText(
    "변경 표시는 지금 필터를 따라요(삭제 숨김)."
  );
  expect(await lastPreviewOptions(page)).toEqual({
    layout: "sideBySide",
    changedPagesOnly: true,
    drawBoxes: true,
    hiddenKinds: ["delete"]
  });

  const previous = panel.getByRole("button", { name: "이전 장" });
  const next = panel.getByRole("button", { name: "다음 장" });
  const firstSheet = panel.getByRole("img", { name: "비교 PDF 1장 미리보기" });
  const firstSource = await firstSheet.getAttribute("src");
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(panel).toContainText("2 / 2장");
  const secondSheet = panel.getByRole("img", { name: "비교 PDF 2장 미리보기" });
  await expect(secondSheet).toBeVisible();
  expect(await secondSheet.getAttribute("src")).not.toBe(firstSource);
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(firstSheet).toBeVisible();

  // A만: A 쪽이 있는 5행 중 숨기지 않은 상자가 A 쪽에 있는 행은 A1 하나. 다시 받으면 첫 장부터다.
  await next.click();
  await layout.getByRole("button", { name: "A만" }).click();
  await expect(dialog).toContainText("(5쪽 → 1쪽)");
  await expect(panel).toContainText("1 / 1장");
  expect((await lastPreviewOptions(page)).layout).toBe("aOnly");

  await changedOnly.click();
  await expect(panel).toContainText("1 / 5장");
  await expect(dialog).not.toContainText("(5쪽 →");
  await drawBoxes.click();
  await expect(panel).toContainText("1 / 5장");
  expect(await lastPreviewOptions(page)).toEqual({
    layout: "aOnly",
    changedPagesOnly: false,
    drawBoxes: false,
    hiddenKinds: ["delete"]
  });
});

test("내보낼 수 없는 이유를 바닥 줄에 보이고 내보내기를 막는다", async ({
  page
}) => {
  await openResult(page, { directoryPicks: [EXPORT_DIRECTORY] });
  let dialog = await openExport(page);
  const exportAction = exportButton(dialog);
  const compareFile = dialog.getByRole("checkbox", { name: "비교 PDF" });
  const annotatedFile = dialog.getByRole("checkbox", { name: "주석 PDF" });

  await expect(dialog).toContainText("저장할 폴더를 골라 주세요.");
  await expect(dialog).toContainText("아직 고르지 않았어요");
  await expect(exportAction).toBeDisabled();

  await dialog.getByRole("button", { name: "고르기" }).click();
  await expect(dialog).toContainText(EXPORT_DIRECTORY);
  await expect(dialog).toContainText("파일 1개를 만들어요");
  await expect(dialog).toContainText(`만들 파일: ${COMPARE_FILE_NAME}`);
  await expect(exportAction).toBeEnabled();

  await annotatedFile.click();
  await expect(dialog).toContainText("파일 2개를 만들어요");
  await expect(dialog).toContainText(
    `만들 파일: ${COMPARE_FILE_NAME}, ${ANNOTATED_FILE_NAME}`
  );

  await compareFile.click();
  await annotatedFile.click();
  await expect(dialog).toContainText("받을 파일을 하나 이상 골라 주세요.");
  await expect(exportAction).toBeDisabled();
  await expect(previewPanel(dialog)).toContainText(
    "미리보기는 비교 PDF만 보여요."
  );
  await expect(
    dialog
      .getByRole("group", { name: "쪽 구성" })
      .getByRole("button", { name: "A만" })
  ).toBeDisabled();

  // 비교 PDF를 다시 켜면 미리보기를 다시 받는다(숨긴 종류 없음: 차이 있는 행 셋).
  await compareFile.click();
  await expect(previewPanel(dialog)).toContainText("1 / 3장");
  await expect(dialog).toContainText("(6쪽 → 3쪽)");

  // 모든 종류를 숨기면 비교 PDF에 넣을 장이 없다(Rust `EMPTY_REPORT`). 주석 PDF만은 만들 수 있다.
  await dialog.getByRole("button", { name: "닫기" }).click();
  for (const chip of ["추가 1", "삭제 1", "변경 1"]) {
    await hideKind(page, chip);
  }
  dialog = await openExport(page);
  await expect(dialog).toContainText(
    "지금 필터로는 비교 PDF에 넣을 쪽이 없어요."
  );
  await expect(previewPanel(dialog)).toContainText(
    "지금 필터로는 넣을 쪽이 없어요."
  );
  await expect(dialog).toContainText("(6쪽 → 0쪽)");
  await expect(exportButton(dialog)).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "비교 PDF" }).click();
  await dialog.getByRole("checkbox", { name: "주석 PDF" }).click();
  await expect(dialog).toContainText("파일 1개를 만들어요");
  await expect(exportButton(dialog)).toBeEnabled();
});

test("고른 폴더에 두 파일을 차례로 만들고 토스트로 알리며, 같은 이름이면 번호를 붙인다", async ({
  page
}) => {
  await openResult(page, {
    directoryPicks: [EXPORT_DIRECTORY, OTHER_DIRECTORY, null]
  });
  await hideKind(page, "삭제 1");
  let dialog = await openExport(page);
  await dialog.getByRole("button", { name: "고르기" }).click();
  await dialog.getByRole("checkbox", { name: "주석 PDF" }).click();
  await exportButton(dialog).click();

  await expect(toast(page, "PDF 2개를 만들었어요")).toContainText(
    `${COMPARE_FILE_NAME}, ${ANNOTATED_FILE_NAME}`
  );
  await expect(dialog).toBeHidden();

  const exports = (await readWrites(page)).filter(
    (call) =>
      call.method === "exportComparePdf" || call.method === "exportAnnotatedPdf"
  );
  expect(exports.map((call) => call.method)).toEqual([
    "exportComparePdf",
    "exportAnnotatedPdf"
  ]);
  const [compareCall, annotatedCall] = exports;
  if (
    compareCall?.method !== "exportComparePdf" ||
    annotatedCall?.method !== "exportAnnotatedPdf"
  ) {
    throw new Error("내보내기 요청 순서가 다릅니다.");
  }
  expect(compareCall.request.before).toBe(BEFORE.path);
  expect(compareCall.request.after).toBe(AFTER.path);
  expect(compareCall.request.result.changes.map((change) => change.id)).toEqual(
    CHANGES.map((change) => change.id)
  );
  expect(compareCall.request.options).toEqual({
    layout: "sideBySide",
    changedPagesOnly: true,
    drawBoxes: true,
    hiddenKinds: ["delete"]
  });
  expect(compareCall.request.output).toEqual({
    directory: EXPORT_DIRECTORY,
    fileName: COMPARE_FILE_NAME
  });
  expect(annotatedCall.request.after).toBe(AFTER.path);
  expect(annotatedCall.request.hiddenKinds).toEqual(["delete"]);
  expect(annotatedCall.request.output).toEqual({
    directory: EXPORT_DIRECTORY,
    fileName: ANNOTATED_FILE_NAME
  });
  expect(compareCall.request.jobId).not.toBe(annotatedCall.request.jobId);

  // 다시 열면 고른 폴더가 남아 있고("바꾸기"), 같은 이름이 있어 번호가 붙은 새 파일을 만든다.
  dialog = await openExport(page);
  await expect(dialog).toContainText(EXPORT_DIRECTORY);
  await exportButton(dialog).click();
  await expect(toast(page, "PDF 1개를 만들었어요")).toContainText(
    "pages-base-insert_비교 (2).pdf"
  );

  // "바꾸기"는 고른 폴더로 바꾸고, 다이얼로그를 취소하면 그대로 둔다.
  dialog = await openExport(page);
  const change = dialog.getByRole("button", { name: "바꾸기" });
  await change.click();
  await expect(dialog).toContainText(OTHER_DIRECTORY);
  await change.click();
  await expect(change).toBeEnabled();
  await expect(dialog).toContainText(OTHER_DIRECTORY);
});

test("옵션을 빠르게 바꾸면 늦게 온 앞 미리보기 응답이 새 미리보기를 덮지 않는다", async ({
  page
}) => {
  await openResult(page);
  await page.evaluate(() => {
    window.__E2E_HOLD_PREVIEW__ = new Promise<void>((resolve) => {
      window.__E2E_RELEASE_PREVIEW__ = resolve;
    });
  });
  const dialog = await openExport(page);
  const panel = previewPanel(dialog);
  await expect(panel.locator("[aria-busy='true']")).toBeVisible();

  // 첫 요청(나란히: 3장)은 붙잡힌 채로 두고, A만(2장)을 고른다.
  await page.evaluate(() => {
    window.__E2E_HOLD_PREVIEW__ = undefined;
  });
  await dialog
    .getByRole("group", { name: "쪽 구성" })
    .getByRole("button", { name: "A만" })
    .click();
  await expect(panel).toContainText("1 / 2장");

  await page.evaluate(() => window.__E2E_RELEASE_PREVIEW__?.());
  await expect
    .poll(() => page.evaluate(() => window.__E2E_MOCK_PREVIEWS_SETTLED__))
    .toBe(2);
  await expect(panel).toContainText("1 / 2장");
  await expect(dialog).toContainText("(5쪽 → 2쪽)");
});

test("내보내는 중 취소하면 그 작업을 취소하고 모달을 닫으며 실패로 알리지 않는다", async ({
  page
}) => {
  await openResult(page);
  await page.evaluate(() => {
    window.__E2E_HOLD_EXPORT__ = new Promise<void>(() => {});
  });
  let dialog = await openExport(page);
  await dialog.getByRole("button", { name: "고르기" }).click();
  await exportButton(dialog).click();
  await expect(
    dialog.getByRole("button", { name: "내보내는 중…" })
  ).toBeDisabled();

  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  const writes = await readWrites(page);
  const exported = writes.find((call) => call.method === "exportComparePdf");
  if (exported?.method !== "exportComparePdf") {
    throw new Error("비교 PDF 내보내기 요청이 없습니다.");
  }
  expect(writes).toContainEqual({
    method: "cancelJob",
    jobId: exported.request.jobId
  });

  // 다음 내보내기가 끝날 때까지 취소한 작업은 토스트를 띄우지 않는다(만든 파일·실패 모두).
  await page.evaluate(() => {
    window.__E2E_HOLD_EXPORT__ = undefined;
  });
  dialog = await openExport(page);
  await exportButton(dialog).click();
  await expect(toast(page, "PDF 1개를 만들었어요")).toHaveCount(1);
  await expect(toast(page, "만들지 못했어요")).toHaveCount(0);
});
