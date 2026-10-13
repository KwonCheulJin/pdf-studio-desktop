import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed
} from "../src/renderer/app/providers/e2e-platform";
import type {
  PageInfo,
  TranslatedPage,
  TranslatedParagraph,
  TranslationPlan,
  TranslationResult
} from "../src/renderer/shared/api/bindings";

/**
 * 번역 결과 대역 보기(계획서 P6-11, 진행 가이드 Step 46, 시안 13).
 * - 끝나면 결과 화면: 머리(`<이름> · 한국어`, 언어·모델·범위 쪽·걸린 시간, "새 번역", "내보내기" 없음), 상태바(문단 수·사용 토큰·완료).
 * - 보기 방식 3종, 쪽 이동(‹ ›·←→·쪽 번호 입력), 글자 배율 50~200%.
 * - 나란히 보기에서 같은 번호의 원문·번역이 같은 행(행 위치·높이 비교).
 * - 문단 고르기(누르기·↑↓)와 양쪽 강조, 용어집 n 팝오버, 쪽 종류 자리표시, 실패·거절·고친 문단.
 * - 옵션 화면의 "결과 보기"(이미 번역됨)도 이 화면을 연다.
 * 결과는 시드 `translateScripts[].result`(계약 JSON과 같은 모양)이다.
 */

const FIXTURE_BYTES = readFileSync(
  path.join(__dirname, "fixtures", "three-pages.pdf")
).toString("base64");

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

const PAGE_COUNT = 24;

const FILE_SPEC: E2eMockFile = {
  path: "/Users/e2e/originals/产品规格说明书_v3.pdf",
  displayName: "产品规格说明书_v3.pdf",
  pages: Array.from({ length: PAGE_COUNT }, () => A4_PAGE),
  sizeBytes: 2_936_012,
  bytesBase64: FIXTURE_BYTES
};

const SPEC_PLAN: TranslationPlan = {
  pageCount: PAGE_COUNT,
  textPages: 22,
  scanPages: 2,
  rangePages: 6,
  detectedLanguage: "zhHans",
  paragraphCount: 8,
  chunkCount: 2,
  estimatedInputTokens: 3_100,
  estimatedOutputTokens: 3_600,
  estimatedCostMicroUsd: 63_000,
  pricingDate: "2026-10-13",
  resumable: null
};

/** 모든 문단이 기록에 있어 보낼 것이 없는 계획(옵션 화면 "결과 보기") */
const ALREADY_TRANSLATED_PLAN: TranslationPlan = {
  ...SPEC_PLAN,
  estimatedInputTokens: 0,
  estimatedOutputTokens: 0,
  estimatedCostMicroUsd: 0,
  resumable: { translatedParagraphs: 8, paragraphCount: 8 }
};

const LONG_SOURCE =
  "本产品适用于工业环境，额定电压为220V，额定频率为50Hz。安装前请切断电源，并确认PS-200 控制器的接地端子已可靠连接。如因未按本说明书操作而造成损坏，不在保修范围内。接线完成后，请使用万用表检查各端子之间的绝缘电阻。本产品适用于工业环境，额定电压为220V，额定频率为50Hz。安装前请切断电源，并确认控制器的接地端子已可靠连接。";

const LONG_TARGET =
  "설치하기 전에 전원을 차단하고 PS-200 컨트롤러의 접지 단자가 확실히 연결되었는지 확인하세요. 이 설명서대로 작업하지 않아 생긴 손상은 보증 범위에 포함되지 않습니다. 배선을 마친 뒤 멀티미터로 각 단자 사이의 절연 저항을 확인하세요. 이 제품은 산업 환경용이며 정격 전압은 220V, 정격 주파수는 50Hz입니다. 설치하기 전에 전원을 차단하고 컨트롤러의 접지 단자가 확실히 연결되었는지 확인하세요. 배선을 마친 뒤 멀티미터로 각 단자 사이의 절연 저항을 다시 확인하세요.";

interface ParagraphSeed {
  page: number;
  number: number;
  source: string;
  target: string | null;
  heading?: boolean;
  status?: TranslatedParagraph["status"];
  failCode?: TranslatedParagraph["failCode"];
}

function paragraph({
  page,
  number,
  source,
  target,
  heading = false,
  status = "translated",
  failCode = null
}: ParagraphSeed): TranslatedParagraph {
  return {
    key: `${page}-${number}-seed`,
    number,
    source,
    target,
    heading,
    status,
    failCode
  };
}

function outOfRange(page: number): TranslatedPage {
  return { page, kind: "outOfRange", paragraphs: [], failCode: null };
}

/**
 * 범위 2~7쪽(색인 1~6):
 * - 2쪽: 제목 + 원문이 긴 문단 + 번역이 긴 문단 + 짧은 문단(행 맞춤)
 * - 3쪽: 실패·거절·고친 문단
 * - 4쪽: 스캔 쪽(옵션 끔) · 5쪽: 스캔 쪽 그림에서 받아 적음 · 6쪽: 문단 없는 글자층 · 7쪽: 그림 쪽 자체 실패
 */
const RESULT_PAGES: TranslatedPage[] = Array.from(
  { length: PAGE_COUNT },
  (_, index) => outOfRange(index)
).map((page) => {
  switch (page.page) {
    case 1:
      return {
        page: 1,
        kind: "textLayer",
        failCode: null,
        paragraphs: [
          paragraph({
            page: 1,
            number: 1,
            source: "第三章 安装与接线",
            target: "제3장 설치 및 배선",
            heading: true
          }),
          paragraph({
            page: 1,
            number: 2,
            source: LONG_SOURCE,
            target: "짧은 번역"
          }),
          paragraph({ page: 1, number: 3, source: "短", target: LONG_TARGET }),
          paragraph({
            page: 1,
            number: 4,
            source: "接线完成后，请检查。",
            target: "배선을 마친 뒤 확인하세요."
          })
        ]
      };
    case 2:
      return {
        page: 2,
        kind: "textLayer",
        failCode: null,
        paragraphs: [
          paragraph({
            page: 2,
            number: 1,
            source: "如因未按本说明书操作而造成损坏。",
            target: null,
            status: "failed",
            failCode: "TRANSLATION_MISMATCH"
          }),
          paragraph({
            page: 2,
            number: 2,
            source: "不在保修范围内。",
            target: null,
            status: "refused",
            failCode: "TRANSLATION_REFUSED"
          }),
          paragraph({
            page: 2,
            number: 3,
            source: "额定频率为50Hz。",
            target: "정격 주파수는 50Hz예요.",
            status: "edited"
          })
        ]
      };
    case 3:
      return { page: 3, kind: "scanSkipped", paragraphs: [], failCode: null };
    case 4:
      return {
        page: 4,
        kind: "image",
        failCode: null,
        paragraphs: [
          paragraph({
            page: 4,
            number: 1,
            source: "扫描页的文字",
            target: "스캔 쪽의 글"
          })
        ]
      };
    case 5:
      return { page: 5, kind: "textLayer", paragraphs: [], failCode: null };
    case 6:
      return {
        page: 6,
        kind: "image",
        paragraphs: [],
        failCode: "TRANSLATION_MISMATCH"
      };
    default:
      return page;
  }
});

const SEEDED_RESULT: TranslationResult = {
  recordId: "seeded-record",
  path: FILE_SPEC.path,
  language: "zhHans",
  model: "sonnet",
  pages: RESULT_PAGES,
  usage: { inputTokens: 31_420, outputTokens: 35_880 },
  elapsedMs: 72_400,
  glossaryUsed: [
    { source: "接地端子", target: "접지 단자" },
    { source: "控制器", target: "컨트롤러" },
    { source: "万用表", target: "멀티미터" }
  ]
};

const TEXT = {
  CONSENT: "문서 내용이 번역을 위해 Anthropic API로 전송되는 것을 확인했어요.",
  TITLE: "产品规格说明书_v3 · 한국어",
  DETAILS: "중국어(간체) → 한국어 · Sonnet 5.5 · 6쪽 · 1분 12초",
  STATUS_SUMMARY: "문단 8개|사용 입력 31,420 · 출력 35,880 토큰",
  MISMATCH: "번역 응답이 문단과 맞지 않았어요. 이 문단을 다시 번역해 주세요.",
  REFUSED:
    "모델이 이 글의 번역을 거절했어요. 다른 모델로 다시 번역해 볼 수 있어요.",
  SCAN_SKIPPED:
    "스캔 쪽이라 번역하지 않았어요. 스캔 페이지 옵션을 켜고 다시 번역할 수 있어요.",
  OUT_OF_RANGE: "번역 범위 밖 쪽이에요.",
  NO_TEXT: "이 쪽에는 번역할 글이 없어요.",
  IMAGE_FAILED: "이 쪽 그림을 읽지 못했어요.",
  GLOSSARY_NOTE: "용어집을 바꾸면 다시 번역해야 반영돼요."
} as const;

async function openTranslate(
  page: Page,
  seed: Omit<E2eMockSeed, "files">
): Promise<void> {
  await page.addInitScript(
    (value) => {
      window.__E2E_MOCK_SEED__ = value;
    },
    {
      files: [FILE_SPEC],
      dialogPicks: [[FILE_SPEC.path]],
      apiKey: { registered: true, hint: "a1F3" },
      ...seed
    }
  );
  await page.goto("/");
  await page
    .getByRole("region", { name: "PDF 번역", exact: true })
    .getByRole("button", { name: "번역할 파일 선택" })
    .click();
  await expect(page.getByRole("heading", { name: "새 번역" })).toBeVisible();
}

function summaryCard(page: Page): Locator {
  return page.getByRole("complementary", { name: "실행 전 확인" });
}

/** 계획을 받은 뒤 동의하고 "번역 시작"을 눌러 결과 화면까지 간다. */
async function openResult(page: Page): Promise<void> {
  await openTranslate(page, {
    translationPlans: [{ plan: SPEC_PLAN }],
    translateScripts: [{ progress: [], result: SEEDED_RESULT }]
  });
  const card = summaryCard(page);
  await card.getByRole("checkbox", { name: TEXT.CONSENT }).check();
  await card.getByRole("button", { name: "번역 시작", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: TEXT.TITLE, level: 1 })
  ).toBeVisible();
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

function panel(page: Page, name: "원문" | "번역"): Locator {
  return page.getByRole("list", { name, exact: true });
}

function rows(page: Page, name: "원문" | "번역"): Locator {
  return panel(page, name).getByRole("listitem");
}

function pageInput(page: Page): Locator {
  return page.getByRole("textbox", { name: "쪽 번호" });
}

async function goToPage(page: Page, pageNumber: number): Promise<void> {
  await pageInput(page).fill(String(pageNumber));
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue(String(pageNumber));
}

interface RowBox {
  y: number;
  height: number;
}

async function rowBoxes(page: Page, name: "원문" | "번역"): Promise<RowBox[]> {
  return rows(page, name).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { y: rect.top, height: rect.height };
    })
  );
}

/** 같은 번호 행의 위 끝·높이가 1px 안에서 같은지 */
async function expectRowsAligned(page: Page): Promise<RowBox[]> {
  const source = await rowBoxes(page, "원문");
  const target = await rowBoxes(page, "번역");
  expect(source).toHaveLength(target.length);
  source.forEach((box, index) => {
    expect(Math.abs(box.y - target[index].y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - target[index].height)).toBeLessThanOrEqual(1);
  });
  return source;
}

async function fontSizeOf(row: Locator): Promise<string> {
  return row.evaluate((element) => getComputedStyle(element).fontSize);
}

test.use({ viewport: { width: 1280, height: 800 } });

test("끝나면 결과 화면이 머리 정보·'새 번역'(내보내기 없음)·상태바 문단 수·사용 토큰과 범위 첫 쪽을 보이고, '새 번역'은 비운 옵션 화면으로 간다", async ({
  page
}) => {
  await openResult(page);

  const header = page.locator("header");
  await expect(header.getByText(TEXT.DETAILS, { exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "새 번역" })).toBeVisible();
  await expect(page.getByRole("button", { name: /내보내기/ })).toHaveCount(0);
  await expect(statusBar(page)).toContainText(TEXT.STATUS_SUMMARY);
  await expect(
    statusBar(page).getByRole("status").filter({ hasText: "상태: 완료" })
  ).toBeVisible();

  // 1쪽은 범위 밖이라 범위 안 첫 쪽(2쪽)에서 시작한다.
  await expect(pageInput(page)).toHaveValue("2");
  await expect(page.getByText("/ 24쪽")).toBeVisible();
  await expect(page.getByText("원문 · 2쪽", { exact: true })).toBeVisible();
  await expect(page.getByText("번역 · 2쪽", { exact: true })).toBeVisible();
  await expect(rows(page, "원문")).toHaveCount(4);
  await expect(rows(page, "번역").first()).toContainText("제3장 설치 및 배선");

  // 제목 문단은 양쪽 모두 굵게
  for (const name of ["원문", "번역"] as const) {
    const weight = await rows(page, name)
      .first()
      .locator("span")
      .last()
      .evaluate((element) => getComputedStyle(element).fontWeight);
    expect(weight).toBe("600");
  }

  await header.getByRole("button", { name: "새 번역" }).click();
  await expect(
    page.getByRole("heading", { name: "새 번역", level: 1 })
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "번역할 문서" })
      .getByRole("button", { name: /^PDF 고르기/ })
  ).toBeVisible();
  await expect(statusBar(page)).toContainText("비어 있음");
  await expect(
    statusBar(page).getByRole("status").filter({ hasText: "상태: 준비" })
  ).toBeVisible();
});

test("나란히 보기에서 같은 번호의 원문·번역이 같은 행에 오고 행 높이는 두 쪽 중 큰 쪽이다(배율을 바꿔도)", async ({
  page
}) => {
  await openResult(page);

  const boxes = await expectRowsAligned(page);
  // 원문이 긴 2번 행과 번역이 긴 3번 행은 짧은 4번 행보다 높다(한쪽 글 높이를 따른다).
  expect(boxes[1].height).toBeGreaterThan(boxes[3].height * 2);
  expect(boxes[2].height).toBeGreaterThan(boxes[3].height * 2);

  await page.getByRole("button", { name: "확대" }).click();
  await page.getByRole("button", { name: "확대" }).click();
  await expect(page.getByRole("status", { name: "배율" })).toHaveText("120%");
  const zoomed = await expectRowsAligned(page);
  expect(zoomed[3].height).toBeGreaterThan(boxes[3].height);
});

test("보기 방식 나란히·번역만·원문만은 보이는 패널을 바꾼다", async ({
  page
}) => {
  await openResult(page);
  const group = page.getByRole("group", { name: "보기 방식" });
  const button = (name: string) =>
    group.getByRole("button", { name, exact: true });

  await expect(button("나란히")).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page, "원문")).toBeVisible();
  await expect(panel(page, "번역")).toBeVisible();

  await button("번역만").click();
  await expect(button("번역만")).toHaveAttribute("aria-pressed", "true");
  await expect(button("나란히")).toHaveAttribute("aria-pressed", "false");
  await expect(panel(page, "원문")).toHaveCount(0);
  await expect(rows(page, "번역")).toHaveCount(4);
  await expect(page.getByText("원문 · 2쪽", { exact: true })).toHaveCount(0);

  await button("원문만").click();
  await expect(panel(page, "번역")).toHaveCount(0);
  await expect(rows(page, "원문")).toHaveCount(4);

  await button("나란히").click();
  await expect(panel(page, "원문")).toBeVisible();
  await expect(panel(page, "번역")).toBeVisible();
});

test("쪽 이동: ‹ ›·←→·쪽 번호 입력(틀린 값은 되돌림), 처음·끝 쪽에서는 막힌다", async ({
  page
}) => {
  await openResult(page);
  const previous = page.getByRole("button", { name: "이전 쪽" });
  const next = page.getByRole("button", { name: "다음 쪽" });

  await next.click();
  await expect(pageInput(page)).toHaveValue("3");
  await expect(page.getByText("번역 · 3쪽", { exact: true })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(pageInput(page)).toHaveValue("4");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(pageInput(page)).toHaveValue("2");

  await goToPage(page, 24);
  await expect(next).toBeDisabled();
  await expect(page.getByText(TEXT.OUT_OF_RANGE)).toBeVisible();

  // 문서에 없는 쪽·숫자가 아닌 값은 지금 쪽으로 되돌린다. Esc도 되돌린다.
  await pageInput(page).fill("99");
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue("24");
  await pageInput(page).fill("abc");
  await pageInput(page).blur();
  await expect(pageInput(page)).toHaveValue("24");
  await pageInput(page).fill("3");
  await pageInput(page).press("Escape");
  await expect(pageInput(page)).toHaveValue("24");

  // 쪽 번호 칸 안의 ←→는 글자 이동이라 쪽을 옮기지 않는다.
  await pageInput(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(pageInput(page)).toHaveValue("24");

  await goToPage(page, 1);
  await expect(previous).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(pageInput(page)).toHaveValue("1");
});

test("배율은 10% 단위로 50~200% 안에서 문단 글자 크기를 바꾼다", async ({
  page
}) => {
  await openResult(page);
  const zoomIn = page.getByRole("button", { name: "확대" });
  const zoomOut = page.getByRole("button", { name: "축소" });
  const level = page.getByRole("status", { name: "배율" });
  const targetRow = rows(page, "번역").nth(3);
  const sourceRow = rows(page, "원문").nth(3);

  await expect(level).toHaveText("100%");
  expect(await fontSizeOf(targetRow)).toBe("14px");
  expect(await fontSizeOf(sourceRow)).toBe("13px");

  for (let step = 0; step < 10; step += 1) await zoomIn.click();
  await expect(level).toHaveText("200%");
  await expect(zoomIn).toBeDisabled();
  expect(await fontSizeOf(targetRow)).toBe("28px");
  expect(await fontSizeOf(sourceRow)).toBe("26px");

  for (let step = 0; step < 15; step += 1) await zoomOut.click();
  await expect(level).toHaveText("50%");
  await expect(zoomOut).toBeDisabled();
  expect(await fontSizeOf(targetRow)).toBe("7px");
});

test("문단은 누르거나 ↑↓로 고르고, 고른 문단은 원문·번역 양쪽 행이 함께 강조된다", async ({
  page
}) => {
  await openResult(page);
  const source = rows(page, "원문");
  const target = rows(page, "번역");

  const expectActive = async (index: number) => {
    for (const name of ["원문", "번역"] as const) {
      await expect(rows(page, name).nth(index)).toHaveAttribute(
        "aria-current",
        "true"
      );
      await expect(panel(page, name).locator("[aria-current]")).toHaveCount(1);
    }
  };

  await expect(page.locator("[aria-current='true']")).toHaveCount(0);
  const idleBackground = await target
    .nth(1)
    .evaluate((element) => getComputedStyle(element).backgroundColor);

  // 원문 행을 눌러도 같은 번호의 번역 행이 함께 강조된다.
  await source.nth(1).click();
  await expectActive(1);
  const [sourceBackground, targetBackground] = await Promise.all(
    [source, target].map((list) =>
      list
        .nth(1)
        .evaluate((element) => getComputedStyle(element).backgroundColor)
    )
  );
  expect(sourceBackground).toBe(targetBackground);
  expect(targetBackground).not.toBe(idleBackground);

  await page.keyboard.press("ArrowDown");
  await expectActive(2);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expectActive(0);
  // 쪽 첫 문단에서 ↑는 그대로다.
  await page.keyboard.press("ArrowUp");
  await expectActive(0);

  await target.nth(3).click();
  await expectActive(3);

  // 쪽을 옮기면 고른 문단을 비우고, ↓는 그 쪽 첫 문단부터 고른다.
  await page.keyboard.press("ArrowRight");
  await expect(pageInput(page)).toHaveValue("3");
  await expect(page.locator("[aria-current='true']")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expectActive(0);
});

test("'용어집 n'은 실은 용어 목록 팝오버를 열고 Esc·바깥 누르기로 닫는다", async ({
  page
}) => {
  await openResult(page);
  const button = page.getByRole("button", { name: "용어집 3" });
  const popover = page.getByRole("dialog", { name: "용어집" });

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(popover.getByRole("listitem")).toHaveText([
    "接地端子→접지 단자",
    "控制器→컨트롤러",
    "万用表→멀티미터"
  ]);
  await expect(popover).toContainText(TEXT.GLOSSARY_NOTE);

  // 팝오버 안의 방향키는 쪽을 옮기지 않는다.
  await page.keyboard.press("ArrowRight");
  await expect(pageInput(page)).toHaveValue("2");

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(button).toBeFocused();

  await button.click();
  await expect(popover).toBeVisible();
  // 팝오버가 덮지 않은 바깥(상태바)을 누른다.
  await statusBar(page).click();
  await expect(popover).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("쪽 종류 자리표시와 실패·거절·고친 문단을 보인다", async ({ page }) => {
  await openResult(page);

  // 3쪽: 실패·거절 문단은 번역 자리에 이유 문구, 고친 문단은 "고침" 배지
  await goToPage(page, 3);
  const target = rows(page, "번역");
  // 실패·거절 문단은 이유 뒤에 "이 문단 다시 번역"이 늘 있다(Step 47, translate-paragraph-actions.spec.ts).
  await expect(target.nth(0)).toHaveText(`1${TEXT.MISMATCH}이 문단 다시 번역`);
  await expect(target.nth(1)).toHaveText(`2${TEXT.REFUSED}이 문단 다시 번역`);
  await expect(target.nth(2)).toHaveText("3정격 주파수는 50Hz예요.고침");
  await expect(rows(page, "원문").nth(0)).toContainText(
    "如因未按本说明书操作而造成损坏。"
  );
  await expect(page.getByText("고침", { exact: true })).toHaveCount(1);

  await goToPage(page, 4);
  await expect(page.getByText(TEXT.SCAN_SKIPPED)).toBeVisible();
  await expect(panel(page, "원문")).toHaveCount(0);

  // 5쪽: 스캔 쪽 그림에서 받아 적은 원문(원문 머리에 배지)
  await goToPage(page, 5);
  await expect(
    page.getByText("이미지에서 읽음", { exact: true })
  ).toBeVisible();
  await expect(rows(page, "원문").first()).toContainText("扫描页的文字");
  await expect(rows(page, "번역").first()).toContainText("스캔 쪽의 글");

  await goToPage(page, 6);
  await expect(page.getByText(TEXT.NO_TEXT)).toBeVisible();
  await expect(page.getByText("이미지에서 읽음", { exact: true })).toHaveCount(
    0
  );

  await goToPage(page, 7);
  await expect(page.getByText(TEXT.IMAGE_FAILED)).toBeVisible();
  await expect(page.getByText(TEXT.MISMATCH)).toBeVisible();

  await goToPage(page, 1);
  await expect(page.getByText(TEXT.OUT_OF_RANGE)).toBeVisible();
});

test("옵션 화면의 '결과 보기'(이미 번역됨)도 결과 화면을 열고, 뒤로 가면 같은 문서의 옵션 화면이다", async ({
  page
}) => {
  await openTranslate(page, {
    translationPlans: [{ plan: ALREADY_TRANSLATED_PLAN }],
    translateScripts: [{ progress: [], result: SEEDED_RESULT }]
  });
  await expect(summaryCard(page)).toContainText(
    "이미 번역한 문서예요 · 추가 요금 없음"
  );
  await summaryCard(page)
    .getByRole("button", { name: "결과 보기", exact: true })
    .click();

  await expect(
    page.getByRole("heading", { name: TEXT.TITLE, level: 1 })
  ).toBeVisible();
  await expect(rows(page, "번역").first()).toContainText("제3장 설치 및 배선");

  await page.getByRole("button", { name: "옵션으로 돌아가기" }).click();
  await expect(summaryCard(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "번역할 문서" })).toContainText(
    "产品规格说明书_v3.pdf"
  );
});
