import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed,
  E2eRetranslateScript,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type {
  PageInfo,
  RetranslateRequest,
  TokenUsage,
  TranslatedParagraph,
  TranslateRequest,
  TranslationPlan,
  TranslationResult
} from "../src/renderer/shared/api/bindings";

/**
 * 번역 결과의 문단 동작(계획서 P6-12, 진행 가이드 Step 47, 시안 13 고른 문단 아래 동작 줄).
 * - 고른 번역 문단 아래 "이 문단 다시 번역"·"직접 고치기"·"복사", 실패·거절 문단은 늘 "이 문단 다시 번역".
 * - 다시 번역: 진행 표시 → 글 교체·사용량 더함, 실패·거절·오류는 토스트 + 원래 글, 한 번에 하나(번역 시작도 막음).
 * - 직접 고치기: 입력 칸(방향키는 쪽·문단을 옮기지 않음), 저장·⌘Enter, 취소·Esc, "고침" 배지, 기록 요청.
 * - 복사: 번역 글을 클립보드(`__E2E_MOCK_CLIPBOARD__`)로, "복사했어요" 토스트.
 * 결과는 시드 `translateScripts[].result`, 다시 번역은 시드 `retranslateScripts`다.
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

const FILE_SPEC: E2eMockFile = {
  path: "/Users/e2e/originals/产品规格说明书_v3.pdf",
  displayName: "产品规格说明书_v3.pdf",
  pages: [A4_PAGE, A4_PAGE],
  sizeBytes: 2_936_012,
  bytesBase64: FIXTURE_BYTES
};

const PLAN: TranslationPlan = {
  pageCount: 2,
  textPages: 2,
  scanPages: 0,
  rangePages: 2,
  detectedLanguage: "zhHans",
  paragraphCount: 6,
  chunkCount: 1,
  estimatedInputTokens: 1_200,
  estimatedOutputTokens: 1_400,
  estimatedCostMicroUsd: 25_000,
  pricingDate: "2026-10-13",
  resumable: null
};

interface ParagraphSeed {
  page: number;
  number: number;
  source: string;
  target: string | null;
  status?: TranslatedParagraph["status"];
  failCode?: TranslatedParagraph["failCode"];
}

function paragraph({
  page,
  number,
  source,
  target,
  status = "translated",
  failCode = null
}: ParagraphSeed): TranslatedParagraph {
  return {
    key: `${page}-${number}-seed`,
    number,
    source,
    target,
    heading: false,
    status,
    failCode
  };
}

const FIRST = paragraph({
  page: 0,
  number: 1,
  source: "安装前请切断电源。",
  target: "설치하기 전에 전원을 차단하세요."
});
const SECOND = paragraph({
  page: 0,
  number: 2,
  source: "接线完成后，请检查。",
  target: "배선을 마친 뒤 확인하세요."
});
const THIRD = paragraph({
  page: 0,
  number: 3,
  source: "额定电压为220V。",
  target: "정격 전압은 220V입니다."
});
const FAILED = paragraph({
  page: 1,
  number: 1,
  source: "如因未按本说明书操作而造成损坏。",
  target: null,
  status: "failed",
  failCode: "TRANSLATION_MISMATCH"
});
const REFUSED = paragraph({
  page: 1,
  number: 2,
  source: "不在保修范围内。",
  target: null,
  status: "refused",
  failCode: "TRANSLATION_REFUSED"
});
const EDITED = paragraph({
  page: 1,
  number: 3,
  source: "额定频率为50Hz。",
  target: "정격 주파수는 50Hz예요.",
  status: "edited"
});

const SEEDED_RESULT: TranslationResult = {
  recordId: "seeded-record",
  path: FILE_SPEC.path,
  language: "zhHans",
  model: "sonnet",
  pages: [
    {
      page: 0,
      kind: "textLayer",
      failCode: null,
      paragraphs: [FIRST, SECOND, THIRD]
    },
    {
      page: 1,
      kind: "textLayer",
      failCode: null,
      paragraphs: [FAILED, REFUSED, EDITED]
    }
  ],
  usage: { inputTokens: 31_420, outputTokens: 35_880 },
  elapsedMs: 72_400,
  glossaryUsed: []
};

const TEXT = {
  CONSENT: "문서 내용이 번역을 위해 Anthropic API로 전송되는 것을 확인했어요.",
  TITLE: "产品规格说明书_v3 · 한국어",
  RETRANSLATE: "이 문단 다시 번역",
  RETRANSLATING: "다시 번역하는 중",
  RETRANSLATE_FAILED: "이 문단을 다시 번역하지 못했어요",
  RETRANSLATE_BLOCKED:
    "문단을 다시 번역하는 중이에요. 끝나면 시작할 수 있어요.",
  EDIT: "직접 고치기",
  COPY: "복사",
  COPIED: "복사했어요",
  MISMATCH: "번역 응답이 문단과 맞지 않았어요. 이 문단을 다시 번역해 주세요.",
  REFUSED:
    "모델이 이 글의 번역을 거절했어요. 다른 모델로 다시 번역해 볼 수 있어요.",
  API_UNAVAILABLE_CODE: "API_UNAVAILABLE"
} as const;

async function openResult(
  page: Page,
  seed: Omit<E2eMockSeed, "files"> = {}
): Promise<void> {
  await page.addInitScript(
    (value) => {
      window.__E2E_MOCK_SEED__ = value;
    },
    {
      files: [FILE_SPEC],
      dialogPicks: [[FILE_SPEC.path]],
      apiKey: { registered: true, hint: "a1F3" },
      translationPlans: [{ plan: PLAN }],
      translateScripts: [{ progress: [], result: SEEDED_RESULT }],
      ...seed
    }
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "PDF 번역", exact: true })
    .click();
  await page.getByRole("button", { name: /^PDF 고르기/ }).click();
  const card = summaryCard(page);
  await card.getByRole("checkbox", { name: TEXT.CONSENT }).check();
  await card.getByRole("button", { name: "번역 시작", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: TEXT.TITLE, level: 1 })
  ).toBeVisible();
}

function summaryCard(page: Page): Locator {
  return page.getByRole("complementary", { name: "실행 전 확인" });
}

function rows(page: Page, name: "원문" | "번역"): Locator {
  return page.getByRole("list", { name, exact: true }).getByRole("listitem");
}

function actions(row: Locator): Locator {
  return row.getByRole("group", { name: "문단 동작" });
}

function pageInput(page: Page): Locator {
  return page.getByRole("textbox", { name: "쪽 번호" });
}

function toasts(page: Page): Locator {
  return page.locator("[data-sonner-toast]");
}

function editor(page: Page): Locator {
  return page.getByRole("textbox", { name: "번역 고치기" });
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

async function retranslateRequests(page: Page): Promise<RetranslateRequest[]> {
  return page.evaluate(() => window.__E2E_MOCK_RETRANSLATES__ ?? []);
}

async function translateRequests(page: Page): Promise<TranslateRequest[]> {
  return page.evaluate(() => window.__E2E_MOCK_TRANSLATES__ ?? []);
}

async function writes(page: Page): Promise<E2eWriteCall[]> {
  return page.evaluate(() => window.__E2E_MOCK_WRITES__ ?? []);
}

/** 다음 다시 번역을 붙잡는다(`__E2E_RELEASE_RETRANSLATE__`로 푼다). */
async function holdRetranslation(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__E2E_HOLD_RETRANSLATE__ = new Promise<void>((resolve) => {
      window.__E2E_RELEASE_RETRANSLATE__ = resolve;
    });
  });
}

async function releaseRetranslation(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__E2E_RELEASE_RETRANSLATE__?.();
    window.__E2E_HOLD_RETRANSLATE__ = undefined;
  });
}

function retranslated(
  paragraphValue: TranslatedParagraph,
  usage: TokenUsage
): E2eRetranslateScript {
  return { result: { paragraph: paragraphValue, usage } };
}

test.use({ viewport: { width: 1280, height: 800 } });

test("고른 번역 문단 아래에 동작 줄이 생기고(원문 쪽은 없음), 실패·거절 문단은 늘 '이 문단 다시 번역'을 보이며, 동작 줄로 높아진 행도 같은 번호 행이 맞는다", async ({
  page
}) => {
  await openResult(page);
  const target = rows(page, "번역");
  const source = rows(page, "원문");

  await expect(page.getByRole("group", { name: "문단 동작" })).toHaveCount(0);
  const before = await expectRowsAligned(page);

  await source.nth(1).click();
  const group = actions(target.nth(1));
  await expect(group.getByRole("button")).toHaveText([
    TEXT.RETRANSLATE,
    TEXT.EDIT,
    TEXT.COPY
  ]);
  await expect(
    group.getByRole("button", { name: TEXT.RETRANSLATE })
  ).toHaveAccessibleDescription("Anthropic API로 다시 보내요");
  await expect(source.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "문단 동작" })).toHaveCount(1);
  const after = await expectRowsAligned(page);
  expect(after[1].height).toBeGreaterThan(before[1].height + 20);

  // 다른 문단을 고르면 동작 줄이 그 문단으로 옮긴다.
  await page.keyboard.press("ArrowDown");
  await expect(actions(target.nth(2))).toBeVisible();
  await expect(page.getByRole("group", { name: "문단 동작" })).toHaveCount(1);

  // 2쪽: 실패·거절 문단은 고르지 않아도 "이 문단 다시 번역"만, 고친 문단은 고르기 전에는 없다.
  await goToPage(page, 2);
  await expect(actions(target.nth(0)).getByRole("button")).toHaveText([
    TEXT.RETRANSLATE
  ]);
  await expect(actions(target.nth(1)).getByRole("button")).toHaveText([
    TEXT.RETRANSLATE
  ]);
  await expect(actions(target.nth(2))).toHaveCount(0);
  await expect(target.nth(0)).toHaveText(
    `1${TEXT.MISMATCH}${TEXT.RETRANSLATE}`
  );
  await expectRowsAligned(page);

  // 실패 문단을 고르면 복사할 글이 없어 "복사"는 없다.
  await target.nth(0).click();
  await expect(actions(target.nth(0)).getByRole("button")).toHaveText([
    TEXT.RETRANSLATE,
    TEXT.EDIT
  ]);
});

test("다시 번역은 그 문단 자리에 진행 표시를 두고, 끝나면 글을 바꾸고 사용량을 더한다. 도는 동안 다른 다시 번역과 번역 시작은 막힌다", async ({
  page
}) => {
  const renewed: TranslatedParagraph = {
    ...FIRST,
    target: "설치 전에 반드시 전원을 끄세요."
  };
  await openResult(page, {
    retranslateScripts: [
      retranslated(renewed, { inputTokens: 100, outputTokens: 50 }),
      retranslated(
        { ...SECOND, target: "배선 뒤 점검하세요." },
        { inputTokens: 80, outputTokens: 40 }
      )
    ]
  });
  const target = rows(page, "번역");
  const statusBar = page.locator("footer");
  await expect(statusBar).toContainText("사용 입력 31,420 · 출력 35,880 토큰");

  await holdRetranslation(page);
  await target.nth(0).click();
  await actions(target.nth(0))
    .getByRole("button", { name: TEXT.RETRANSLATE })
    .click();

  // 진행 표시는 그 문단 자리에, 글은 끝날 때까지 그대로다.
  await expect(
    target.nth(0).getByRole("status").filter({ hasText: TEXT.RETRANSLATING })
  ).toBeVisible();
  await expect(target.nth(0)).toContainText(FIRST.target ?? "");
  await expect(actions(target.nth(0))).toHaveCount(0);
  // 한 번에 하나: 다른 문단의 다시 번역은 막힌다.
  await target.nth(1).click();
  await expect(
    actions(target.nth(1)).getByRole("button", { name: TEXT.RETRANSLATE })
  ).toBeDisabled();

  const [request] = await retranslateRequests(page);
  const [translateRequest] = await translateRequests(page);
  expect(request).toEqual({
    jobId: expect.any(String),
    recordId: SEEDED_RESULT.recordId,
    path: FILE_SPEC.path,
    key: FIRST.key,
    options: translateRequest.options
  });
  expect(request.jobId).not.toBe(translateRequest.jobId);

  await releaseRetranslation(page);
  await expect(target.nth(0)).toHaveText(`1${renewed.target}`);
  await expect(statusBar).toContainText("사용 입력 31,520 · 출력 35,930 토큰");
  await expect(toasts(page)).toHaveCount(0);
  await expect(
    actions(target.nth(1)).getByRole("button", { name: TEXT.RETRANSLATE })
  ).toBeEnabled();

  // 다시 번역이 도는 동안 옵션 화면의 번역 시작도 막힌다(Rust도 JOB_ALREADY_RUNNING).
  await holdRetranslation(page);
  await actions(target.nth(1))
    .getByRole("button", { name: TEXT.RETRANSLATE })
    .click();
  await expect(
    target.nth(1).getByRole("status").filter({ hasText: TEXT.RETRANSLATING })
  ).toBeVisible();
  await page.getByRole("button", { name: "옵션으로 돌아가기" }).click();
  const start = summaryCard(page).getByRole("button", {
    name: "번역 시작",
    exact: true
  });
  await expect(start).toBeDisabled();
  await expect(start).toHaveAccessibleDescription(TEXT.RETRANSLATE_BLOCKED);

  await releaseRetranslation(page);
  await expect(start).not.toHaveAccessibleDescription(TEXT.RETRANSLATE_BLOCKED);
  expect(await translateRequests(page)).toHaveLength(1);
  expect(await retranslateRequests(page)).toHaveLength(2);
});

test("다시 번역이 거절·실패로 오거나 오류면 토스트로 알리고 원래 글을 둔다(받은 사용량은 더한다). 실패 문단은 번역을 받으면 글로 바뀐다", async ({
  page
}) => {
  await openResult(page, {
    retranslateScripts: [
      retranslated(
        {
          ...FIRST,
          target: null,
          status: "refused",
          failCode: "TRANSLATION_REFUSED"
        },
        { inputTokens: 120, outputTokens: 0 }
      ),
      { failCode: TEXT.API_UNAVAILABLE_CODE },
      retranslated(
        {
          ...FAILED,
          target: "설명서대로 하지 않아 생긴 손상.",
          status: "translated",
          failCode: null
        },
        { inputTokens: 90, outputTokens: 30 }
      )
    ]
  });
  const target = rows(page, "번역");
  const statusBar = page.locator("footer");

  await target.nth(0).click();
  const retranslate = actions(target.nth(0)).getByRole("button", {
    name: TEXT.RETRANSLATE
  });
  await retranslate.click();
  const refusedToast = toasts(page).filter({
    hasText: TEXT.RETRANSLATE_FAILED
  });
  await expect(refusedToast).toContainText(TEXT.REFUSED);
  await expect(target.nth(0)).toContainText(FIRST.target ?? "");
  await expect(target.nth(0)).not.toContainText(TEXT.REFUSED);
  await expect(statusBar).toContainText("사용 입력 31,540 · 출력 35,880 토큰");

  await retranslate.click();
  await expect(
    toasts(page).filter({ hasText: "Anthropic API가 지금 응답하지 않아요" })
  ).toContainText(TEXT.RETRANSLATE_FAILED);
  await expect(target.nth(0)).toContainText(FIRST.target ?? "");
  await expect(retranslate).toBeEnabled();
  await expect(statusBar).toContainText("사용 입력 31,540 · 출력 35,880 토큰");

  await goToPage(page, 2);
  await actions(target.nth(0))
    .getByRole("button", { name: TEXT.RETRANSLATE })
    .click();
  // 이유 문구 대신 받은 글이고, 글이 생겨 고른 문단의 동작 줄에 "복사"가 생긴다.
  await expect(target.nth(0)).toHaveText(
    `1설명서대로 하지 않아 생긴 손상.${TEXT.RETRANSLATE}${TEXT.EDIT}${TEXT.COPY}`
  );
  await expect(statusBar).toContainText("사용 입력 31,630 · 출력 35,910 토큰");
});

test("직접 고치기는 번역 자리를 입력 칸으로 바꾸고(방향키는 쪽·문단을 옮기지 않는다) ⌘Enter·저장으로 기록에 쓰며 '고침' 배지를 단다. 취소·Esc는 그대로, 비워 저장하면 원래 번역이다", async ({
  page
}) => {
  await openResult(page);
  const target = rows(page, "번역");
  const editButton = actions(target.nth(0)).getByRole("button", {
    name: TEXT.EDIT
  });

  await target.nth(0).click();
  await editButton.click();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue(FIRST.target ?? "");
  await expect(actions(target.nth(0))).toHaveCount(0);
  await expectRowsAligned(page);

  // 입력 칸 안의 방향키는 글자 커서만 옮긴다.
  for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"]) {
    await editor(page).press(key);
  }
  await expect(target.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(pageInput(page)).toHaveValue("1");

  await editor(page).fill("고치다 만 글");
  await editor(page).press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await expect(target.nth(0)).toHaveText(
    `1${FIRST.target}${TEXT.RETRANSLATE}${TEXT.EDIT}${TEXT.COPY}`
  );

  await editButton.click();
  await editor(page).fill("고치다 만 글");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await writes(page)).toEqual([]);

  await editButton.click();
  await editor(page).fill("  고친 번역입니다.  ");
  await editor(page).press("Meta+Enter");
  await expect(editor(page)).toHaveCount(0);
  await expect(target.nth(0)).toContainText("고친 번역입니다.고침");
  const [translateRequest] = await translateRequests(page);
  expect(await writes(page)).toEqual([
    {
      method: "editTranslatedParagraph",
      request: {
        recordId: SEEDED_RESULT.recordId,
        path: FILE_SPEC.path,
        key: FIRST.key,
        text: "  고친 번역입니다.  ",
        options: translateRequest.options
      }
    }
  ]);
  await expectRowsAligned(page);

  // 비워 저장하면 원래 번역으로 돌아간다(배지 없음).
  await editButton.click();
  await expect(editor(page)).toHaveValue("고친 번역입니다.");
  await editor(page).fill("");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(target.nth(0)).toContainText(FIRST.target ?? "");
  await expect(page.getByText("고침", { exact: true })).toHaveCount(0);
  expect(await writes(page)).toHaveLength(2);
});

test("복사는 그 문단 번역 글(고친 글 포함)을 클립보드로 보내고 '복사했어요' 토스트를 띄운다", async ({
  page
}) => {
  await openResult(page);
  const target = rows(page, "번역");

  await target.nth(1).click();
  await actions(target.nth(1)).getByRole("button", { name: TEXT.COPY }).click();
  await expect(toasts(page).filter({ hasText: TEXT.COPIED })).toBeVisible();

  await goToPage(page, 2);
  await target.nth(2).click();
  await actions(target.nth(2)).getByRole("button", { name: TEXT.COPY }).click();

  expect(await page.evaluate(() => window.__E2E_MOCK_CLIPBOARD__)).toEqual([
    SECOND.target,
    EDITED.target
  ]);
});
