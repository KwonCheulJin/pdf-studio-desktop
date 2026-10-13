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
 * 번역 진입(계획서 P6-7, 진행 가이드 Step 42, 시안 1·10 머리).
 * - 홈 번역 카드: 누르면 열기 다이얼로그(PDF 1개), 카드에 놓으면 그 파일로 번역 모드. 2개 이상·PDF 아님은 알리고 홈에 남는다.
 * - 모드 탭 `[병합 | 비교 | 번역]`: 모드를 오가도 번역 세션과 읽은 문서가 남는다.
 * - 번역 화면: 빈 상태는 점선 "PDF 고르기", 채우면 썸네일·이름·크기·쪽수·"교체"(`openFiles` 결과). 계획으로 더하는
 *   글자층·스캔 쪽 수와 감지 배지는 `translate-options.spec.ts`가 본다.
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

// 크기는 1024 단위: 2,936,012 B = 2.8 MB, 20,480 B = 20 KB
const FILE_SPEC = seedFile({
  displayName: "spec-v3.pdf",
  pageCount: 24,
  sizeBytes: 2_936_012
});
const FILE_MANUAL = seedFile({
  displayName: "manual.pdf",
  pageCount: 5,
  sizeBytes: 20_480
});
const FILE_LOCKED = seedFile({
  displayName: "locked.pdf",
  pageCount: 2,
  sizeBytes: 2_048
});
/** 열 때 PDF로 바뀌는 TIFF(병합은 받지만 번역은 받지 않는다) */
const FILE_TIFF: E2eMockFile = {
  path: "/Users/e2e/originals/scan.tif",
  displayName: "scan.pdf",
  pages: [A4_PAGE],
  convertedPath: "/mock/converted/scan.pdf",
  bytesBase64: FIXTURE_BYTES
};

/** mock `fileStem`은 시드 표시 이름에서 확장자를 뺀다(알림 제목에 쓰인다). */
const TIFF_STEM = "scan";
const LOCKED_STEM = "locked";

const ALL_FILES = [FILE_SPEC, FILE_MANUAL, FILE_LOCKED, FILE_TIFF];

async function openHome(
  page: Page,
  seed: Omit<E2eMockSeed, "files"> = {}
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

function fileCard(page: Page): Locator {
  return page.getByRole("region", { name: "번역할 문서" });
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

function toast(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/** 번역 화면 머리의 제목 */
function translateHeading(page: Page): Locator {
  return page.getByRole("heading", { name: "새 번역" });
}

interface FilledFileText {
  name: string;
  /** 크기 · 쪽수(mono 줄 앞부분. 계획을 받으면 뒤에 글자층·스캔 쪽 수가 붙는다) */
  meta: string;
}

/** 채운 파일 카드: 이름·크기·쪽수·"교체"·썸네일(첫 쪽 렌더) */
async function expectFilledCard(
  page: Page,
  { name, meta }: FilledFileText
): Promise<void> {
  const card = fileCard(page);
  await expect(card).toContainText(name);
  await expect(
    card.getByText(new RegExp(`^${meta.split(".").join("\\.")}( · |$)`))
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "교체" })).toBeVisible();
  await expect(card.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect(card.getByRole("button", { name: /^PDF 고르기/ })).toHaveCount(
    0
  );
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

/** 홈 번역 카드에 파일 하나를 놓아 파일이 든 번역 화면으로 들어간다. */
async function openTranslateWith(
  page: Page,
  file: E2eMockFile,
  seed: Omit<E2eMockSeed, "files"> = {}
): Promise<void> {
  await openHome(page, seed);
  await dropOn(page, homeCard(page, "PDF 번역"), [file.path]);
  await expect(translateHeading(page)).toBeVisible();
}

test("홈에 번역 카드가 세 번째로 있고 버튼으로 PDF를 고르면 번역 화면에 이름·크기·쪽수가 보인다", async ({
  page
}) => {
  await openHome(page, { dialogPicks: [[FILE_SPEC.path]] });
  const cards = page.getByRole("main").getByRole("region");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(2)).toHaveAccessibleName("PDF 번역");
  const card = homeCard(page, "PDF 번역");
  await expect(card).toContainText(
    "중국어·영어 PDF를 한국어로 옮겨 원문과 나란히 보여 줘요. 내 Claude API 키로 실행해요."
  );
  await expect(card).toContainText("PDF 1개 · 인터넷 연결 필요");

  await card.getByRole("button", { name: "번역할 파일 선택" }).click();

  await expect(translateHeading(page)).toBeVisible();
  await expect(page.getByText("중국어·영어 PDF를 한국어로")).toBeVisible();
  await expect(modeTab(page, "번역")).toHaveAttribute("aria-selected", "true");
  await expectFilledCard(page, {
    name: FILE_SPEC.displayName,
    meta: "2.8 MB · 24쪽"
  });
  await expect(statusBar(page)).toContainText("24쪽");
  await expect(statusBar(page)).toContainText("상태: 준비");
});

test("모드 탭은 병합·비교·번역 순서이고, 다른 탭을 고르면 번역 탭이 풀린다", async ({
  page
}) => {
  await openTranslateWith(page, FILE_MANUAL);

  await expect(
    page.getByRole("tablist", { name: "작업 모드" }).getByRole("tab")
  ).toHaveText(["병합", "비교", "번역"]);
  await modeTab(page, "비교").click();
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
  await expect(modeTab(page, "비교")).toHaveAttribute("aria-selected", "true");
  await expect(modeTab(page, "번역")).toHaveAttribute("aria-selected", "false");
});

test("번역 카드에는 PDF 1개만 놓을 수 있고, 카드 밖·2개 이상·PDF가 아니거나 열 수 없는 파일이면 홈에 남는다", async ({
  page
}) => {
  await openHome(page, {
    failures: { openFiles: { [FILE_LOCKED.path]: "PASSWORD_PROTECTED" } }
  });
  const card = homeCard(page, "PDF 번역");

  // 카드 밖(제목)에 놓으면 아무 작업에도 넣지 않는다.
  await dropOn(
    page,
    page.getByRole("heading", { name: "어떤 작업을 할까요?" }),
    [FILE_SPEC.path]
  );
  await expect(page.getByRole("tablist")).toHaveCount(0);

  // 2개는 어느 것을 번역할지 알 수 없어 넣지 않고 알린다.
  await dropOn(page, card, [FILE_SPEC.path, FILE_MANUAL.path]);
  await expect(
    toast(page, "번역할 파일은 1개까지 넣을 수 있어요.")
  ).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);

  // TIFF는 PDF가 아니라 열지 않고 알린다.
  await dropOn(page, card, [FILE_TIFF.path]);
  await expect(
    toast(page, `"${TIFF_STEM}" 파일은 번역할 수 없어요.`)
  ).toContainText(
    "PDF만 번역할 수 있어요. TIFF는 병합에서 PDF로 저장한 뒤 넣어 주세요."
  );
  await expect(page.getByRole("tablist")).toHaveCount(0);

  // 열 수 없는 PDF는 코드의 문구로 알린다.
  await dropOn(page, card, [FILE_LOCKED.path]);
  await expect(
    toast(page, `"${LOCKED_STEM}" 파일을 열 수 없어요.`)
  ).toContainText("암호가 걸린 PDF라 열 수 없어요.");
  await expect(page.getByRole("tablist")).toHaveCount(0);

  await dropOn(page, card, [FILE_SPEC.path]);

  await expect(modeTab(page, "번역")).toHaveAttribute("aria-selected", "true");
  await expectFilledCard(page, {
    name: FILE_SPEC.displayName,
    meta: "2.8 MB · 24쪽"
  });
});

test("열기 다이얼로그에서 2개 이상 고르면 알리고 홈에 남는다", async ({
  page
}) => {
  await openHome(page, { dialogPicks: [[FILE_SPEC.path, FILE_MANUAL.path]] });

  await homeCard(page, "PDF 번역")
    .getByRole("button", { name: "번역할 파일 선택" })
    .click();

  await expect(
    toast(page, "번역할 파일은 1개까지 넣을 수 있어요.")
  ).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
});

test("파일 없이 들어간 번역 화면은 빈 점선 영역이고, 누르거나 놓은 PDF가 들어가며 교체할 수 있다", async ({
  page
}) => {
  // 첫 열기 다이얼로그(병합 카드)는 첫 목록을 쓰고, 번역 화면은 그다음 목록을 쓴다.
  await openHome(page, {
    dialogPicks: [[FILE_MANUAL.path], [FILE_SPEC.path], [FILE_MANUAL.path]]
  });
  await homeCard(page, "PDF 병합")
    .getByRole("button", { name: "파일 선택", exact: true })
    .click();
  await modeTab(page, "번역").click();

  await expect(translateHeading(page)).toBeVisible();
  const pickButton = fileCard(page).getByRole("button", {
    name: /^PDF 고르기/
  });
  await expect(pickButton).toBeVisible();
  await expect(fileCard(page).getByText("교체")).toHaveCount(0);
  await expect(statusBar(page)).toContainText("비어 있음");

  await pickButton.click();
  await expectFilledCard(page, {
    name: FILE_SPEC.displayName,
    meta: "2.8 MB · 24쪽"
  });
  await expect(statusBar(page)).toContainText("24쪽");

  await fileCard(page).getByRole("button", { name: "교체" }).click();
  await expectFilledCard(page, {
    name: FILE_MANUAL.displayName,
    meta: "20 KB · 5쪽"
  });
  await expect(statusBar(page)).toContainText("5쪽");

  // 창 어디에 놓아도 받고(카드 밖), 2개는 알리고 그대로 둔다.
  await dropOn(page, translateHeading(page), [FILE_SPEC.path]);
  await expectFilledCard(page, {
    name: FILE_SPEC.displayName,
    meta: "2.8 MB · 24쪽"
  });
  await dropOn(page, fileCard(page), [FILE_MANUAL.path, FILE_SPEC.path]);
  await expect(
    toast(page, "번역할 파일은 1개까지 넣을 수 있어요.")
  ).toBeVisible();
  await expect(fileCard(page)).toContainText(FILE_SPEC.displayName);
});

test("모드를 오가도 번역 문서가 그대로이고 다시 읽지 않는다", async ({
  page
}) => {
  await openTranslateWith(page, FILE_SPEC);
  await expectFilledCard(page, {
    name: FILE_SPEC.displayName,
    meta: "2.8 MB · 24쪽"
  });
  const readsBefore = await page.evaluate(
    () => window.__E2E_MOCK_READS__ ?? []
  );
  expect(readsBefore).toEqual([FILE_SPEC.path]);

  // 비교·병합 화면을 거쳐 돌아온다.
  await modeTab(page, "비교").click();
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
  await modeTab(page, "병합").click();
  await expect(modeTab(page, "병합")).toHaveAttribute("aria-selected", "true");
  await modeTab(page, "번역").click();

  await expectFilledCard(page, {
    name: FILE_SPEC.displayName,
    meta: "2.8 MB · 24쪽"
  });
  expect(await page.evaluate(() => window.__E2E_MOCK_READS__ ?? [])).toEqual(
    readsBefore
  );
});

test("병합 결과 미리보기에 임시 결과가 있으면 번역으로 넘어가기 전에 확인하고, 넘어가도 결과는 남는다", async ({
  page
}) => {
  await openHome(page, {
    dialogPicks: [[FILE_SPEC.path, FILE_MANUAL.path]]
  });
  await homeCard(page, "PDF 병합")
    .getByRole("button", { name: "파일 선택", exact: true })
    .click();
  await page.getByRole("button", { name: "병합", exact: true }).click();
  const downloadButton = page.getByRole("button", { name: "다운로드" });
  await expect(downloadButton).toBeVisible();
  const dialog = page.getByRole("dialog", {
    name: "저장하지 않은 병합 결과가 있어요"
  });

  // 취소하면 미리보기에 그대로 있다.
  await modeTab(page, "번역").click();
  await expect(dialog).toContainText(
    "번역으로 넘어가도 병합 결과는 그대로 남아요."
  );
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  await expect(downloadButton).toBeVisible();
  await expect(modeTab(page, "병합")).toHaveAttribute("aria-selected", "true");

  // 넘어가도 임시 결과는 지우지 않아 병합 탭으로 돌아오면 그대로 보인다.
  await modeTab(page, "번역").click();
  await dialog.getByRole("button", { name: "번역으로 이동" }).click();
  await expect(translateHeading(page)).toBeVisible();
  await modeTab(page, "병합").click();
  await expect(downloadButton).toBeVisible();
});
