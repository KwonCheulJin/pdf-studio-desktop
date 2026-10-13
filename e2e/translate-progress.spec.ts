import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type {
  PageInfo,
  TranslateProgress,
  TranslatedParagraph,
  TranslationPlan,
  TranslationResult
} from "../src/renderer/shared/api/bindings";

/**
 * 번역 진행 화면(계획서 P6-10, 진행 가이드 Step 45, 시안 12).
 * - 실행하면 옵션 화면 자리에 진행 카드: 문서·언어·모델, 전체 %·경과·막대, 3단계 행(상태·세부·%·막대), 사용 토큰·예상 합계.
 * - 다른 모드 상태바에 "번역 중 n%"가 보이고 돌아오면 카드가 그대로다. 끝나면 결과 화면(Step 46)이다.
 * - 취소하면 `cancelJob`을 보내고 옵션 화면으로 돌아가 남은 문단(다시 받은 계획의 이어하기)을 보인다.
 * - 실패하면 같은 자리에 원인·멈춘 곳·코드와 "다시 시도(이어서)"·"닫기", 키 오류면 "키 바꾸기".
 * 진행률은 시드 `translateScripts`이고 ADR 0002 §9 공식으로 손으로 셈한 값이다(앱은 받은 값을 그대로 보인다).
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
  path: "/Users/e2e/originals/spec-v3.pdf",
  displayName: "spec-v3.pdf",
  pages: Array.from({ length: 24 }, () => A4_PAGE),
  sizeBytes: 2_936_012,
  bytesBase64: FIXTURE_BYTES
};

/** 자동 감지 + 간체 감지(상태·진행 카드는 "중국어"), 범위 22쪽·318문단·14묶음 */
const SPEC_PLAN: TranslationPlan = {
  pageCount: 24,
  textPages: 22,
  scanPages: 2,
  rangePages: 22,
  detectedLanguage: "zhHans",
  paragraphCount: 318,
  chunkCount: 14,
  estimatedInputTokens: 31_420,
  estimatedOutputTokens: 35_880,
  estimatedCostMicroUsd: 632_100,
  pricingDate: "2026-10-13",
  resumable: null
};

/** 취소 뒤 다시 받은 계획: 기록에 159문단이 있어 남은 것만 예상한다. */
const RESUMABLE_PLAN: TranslationPlan = {
  ...SPEC_PLAN,
  estimatedInputTokens: 15_700,
  estimatedOutputTokens: 17_900,
  estimatedCostMicroUsd: 315_000,
  resumable: { translatedParagraphs: 159, paragraphCount: 318 }
};

const JOB_ID = "seeded-job";
const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

/**
 * 문서 읽기 → 번역 3 / 14묶음까지(ADR 0002 §9):
 * - 문서 읽기 100%: 전체 ⌊(0 + 100 × 10) / 100⌋ = 10
 * - 번역 3 / 14: 단계 ⌊300 / 14⌋ = 21, 전체 ⌊(10 × 100 + 21 × 80) / 100⌋ = ⌊2680 / 100⌋ = 26
 * 단계 %와 전체 %가 달라 둘을 바꿔 보이면 드러난다.
 */
const PROGRESS_TRANSLATING: TranslateProgress[] = [
  {
    jobId: JOB_ID,
    stage: "readDocument",
    done: 0,
    total: 22,
    stagePercent: 0,
    overallPercent: 0,
    paragraphsDone: 0,
    paragraphCount: 0,
    usage: NO_USAGE
  },
  {
    jobId: JOB_ID,
    stage: "readDocument",
    done: 22,
    total: 22,
    stagePercent: 100,
    overallPercent: 10,
    paragraphsDone: 0,
    paragraphCount: 318,
    usage: NO_USAGE
  },
  {
    jobId: JOB_ID,
    stage: "translate",
    done: 0,
    total: 14,
    stagePercent: 0,
    overallPercent: 10,
    paragraphsDone: 0,
    paragraphCount: 318,
    usage: NO_USAGE
  },
  {
    jobId: JOB_ID,
    stage: "translate",
    done: 3,
    total: 14,
    stagePercent: 21,
    overallPercent: 26,
    paragraphsDone: 68,
    paragraphCount: 318,
    usage: { inputTokens: 6_940, outputTokens: 8_210 }
  }
];

function paragraph(number: number): TranslatedParagraph {
  return {
    key: `p-${number}`,
    number,
    source: `原文 ${number}`,
    target: `번역 ${number}`,
    heading: false,
    status: "translated",
    failCode: null
  };
}

/** 문단 3개, 기록 누적 사용량 31,420 / 35,880 */
const SEEDED_RESULT: TranslationResult = {
  recordId: "seeded-record",
  path: FILE_SPEC.path,
  language: "zhHans",
  model: "sonnet",
  pages: [
    {
      page: 0,
      kind: "textLayer",
      paragraphs: [paragraph(1), paragraph(2)],
      failCode: null
    },
    { page: 1, kind: "textLayer", paragraphs: [paragraph(1)], failCode: null }
  ],
  usage: { inputTokens: 31_420, outputTokens: 35_880 },
  elapsedMs: 72_000,
  glossaryUsed: []
};

const TEXT = {
  CONSENT: "문서 내용이 번역을 위해 Anthropic API로 전송되는 것을 확인했어요.",
  RESUMABLE:
    "번역한 문단 159 / 318개가 남아 있어요. 번역 시작하면 이어서 해요.",
  DONE_TITLE: "spec-v3 · 한국어",
  DONE_SUMMARY: "문단 3개|사용 입력 31,420 · 출력 35,880 토큰",
  API_UNAVAILABLE:
    "Anthropic API가 지금 응답하지 않아요. 잠시 후 이어서 다시 시도해 주세요.",
  API_KEY_INVALID: "API 키가 올바르지 않아요. 키를 다시 확인해 주세요."
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

/** 계획을 받은 뒤 동의하고 "번역 시작"을 누른다. */
async function startTranslation(page: Page): Promise<void> {
  const card = summaryCard(page);
  await expect(
    card
      .locator("dt", { hasText: "문단" })
      .locator("xpath=following-sibling::dd[1]")
  ).toHaveText("318개 · 14묶음");
  await card.getByRole("checkbox", { name: TEXT.CONSENT }).check();
  await card.getByRole("button", { name: "번역 시작", exact: true }).click();
}

async function holdTranslate(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__E2E_HOLD_TRANSLATE__ = new Promise((resolve) => {
      window.__E2E_RELEASE_TRANSLATE__ = resolve;
    });
  });
}

async function releaseTranslate(page: Page): Promise<void> {
  await page.evaluate(() => window.__E2E_RELEASE_TRANSLATE__?.());
}

function progressCard(page: Page): Locator {
  return page.getByRole("region", { name: "전체 진행률" });
}

function stageRow(page: Page, label: string): Locator {
  return progressCard(page)
    .getByRole("list", { name: "작업별 진행" })
    .getByRole("listitem")
    .filter({ has: page.getByText(label, { exact: true }) });
}

function stageBar(page: Page, label: string): Locator {
  return progressCard(page).getByRole("progressbar", {
    name: `${label} 진행률`,
    exact: true
  });
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

function statusText(page: Page, text: string): Locator {
  return statusBar(page).getByRole("status").filter({ hasText: text });
}

function modeTab(page: Page, name: string): Locator {
  return page
    .getByRole("tablist", { name: "작업 모드" })
    .getByRole("tab", { name, exact: true });
}

function failureCard(page: Page): Locator {
  return page.getByRole("alertdialog", { name: "번역하지 못했어요" });
}

function resultHeading(page: Page): Locator {
  return page.getByRole("heading", { name: TEXT.DONE_TITLE, level: 1 });
}

async function translateRequests(page: Page) {
  return page.evaluate(() => window.__E2E_MOCK_TRANSLATES__ ?? []);
}

async function writeCalls(page: Page): Promise<E2eWriteCall[]> {
  return page.evaluate(() => window.__E2E_MOCK_WRITES__ ?? []);
}

test.use({ viewport: { width: 1280, height: 800 } });

test("실행하면 진행 카드에 문서·언어·모델, 전체 %·경과, 3단계 행과 사용 토큰·예상 합계가 보인다", async ({
  page
}) => {
  await openTranslate(page, {
    translationPlans: [{ plan: SPEC_PLAN }],
    translateScripts: [{ progress: PROGRESS_TRANSLATING }]
  });
  await holdTranslate(page);
  await startTranslation(page);

  const card = progressCard(page);
  await expect(card).toBeVisible();
  await expect(summaryCard(page)).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "번역하는 중", level: 1 })
  ).toBeVisible();
  await expect(
    page.getByText("다른 화면으로 가도 계속 진행돼요")
  ).toBeVisible();
  await expect(card).toContainText(
    "spec-v3.pdf · 중국어 → 한국어 · Sonnet 5.5"
  );

  // 전체 %는 받은 전체 값(단계 % 21이 아니다)
  await expect(card.getByText("26%", { exact: true })).toBeVisible();
  await expect(card.getByText(/^경과 \d+:\d{2}$/)).toBeVisible();
  await expect(
    card.getByRole("progressbar", { name: "전체 진행률", exact: true })
  ).toHaveAttribute("aria-valuenow", "26");
  await expect(statusText(page, "상태: 번역 중 26%")).toBeVisible();

  await expect(
    card.getByRole("list", { name: "작업별 진행" }).getByRole("listitem")
  ).toHaveCount(3);
  await expect(stageRow(page, "문서 읽기")).toContainText(
    "22 / 22쪽 · 문단 318개"
  );
  await expect(stageRow(page, "문서 읽기")).toContainText("100%");
  await expect(stageBar(page, "문서 읽기")).toHaveAttribute(
    "aria-valuenow",
    "100"
  );
  await expect(stageRow(page, "번역")).toContainText(
    "3 / 14묶음 · 문단 68 / 318"
  );
  await expect(stageRow(page, "번역")).toContainText("21%");
  await expect(stageBar(page, "번역")).toHaveAttribute("aria-valuenow", "21");
  await expect(stageRow(page, "대역 배치")).toContainText(
    "번역문을 원문 문단에 맞추기"
  );
  await expect(stageRow(page, "대역 배치")).toContainText("0%");
  await expect(stageBar(page, "대역 배치")).toHaveAttribute(
    "aria-valuenow",
    "0"
  );

  // 사용량은 이번 실행의 진행 이벤트 값, 예상 합계는 계획의 예상 입력 + 출력(31,420 + 35,880)
  await expect(card).toContainText("지금까지 사용");
  await expect(card).toContainText("입력 6,940 토큰");
  await expect(card).toContainText("출력 8,210 토큰");
  await expect(card).toContainText("예상 합계 약 67,300");
});

test("진행 중 다른 모드로 가도 상태바에 번역 % 가 보이고, 돌아오면 카드가 그대로이며, 끝나면 결과 화면으로 간다", async ({
  page
}) => {
  await openTranslate(page, {
    translationPlans: [{ plan: SPEC_PLAN }],
    translateScripts: [
      { progress: PROGRESS_TRANSLATING, result: SEEDED_RESULT }
    ]
  });
  await holdTranslate(page);
  await startTranslation(page);
  await expect(
    progressCard(page).getByText("26%", { exact: true })
  ).toBeVisible();

  await modeTab(page, "병합").click();
  await expect(progressCard(page)).toBeHidden();
  await expect(statusText(page, "번역 중 26%")).toBeVisible();

  await modeTab(page, "비교").click();
  await expect(statusText(page, "번역 중 26%")).toBeVisible();

  await modeTab(page, "번역").click();
  await expect(
    progressCard(page).getByText("26%", { exact: true })
  ).toBeVisible();
  await expect(stageRow(page, "번역")).toContainText("3 / 14묶음");

  await modeTab(page, "병합").click();
  await releaseTranslate(page);
  await expect(statusText(page, "번역 중")).toHaveCount(0);

  await modeTab(page, "번역").click();
  await expect(resultHeading(page)).toBeVisible();
  await expect(statusBar(page)).toContainText(TEXT.DONE_SUMMARY);
  await expect(statusText(page, "상태: 완료")).toBeVisible();

  // 옵션으로 돌아가면 같은 문서·옵션이 그대로다.
  await page.getByRole("button", { name: "옵션으로 돌아가기" }).click();
  await expect(summaryCard(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "번역할 문서" })).toContainText(
    "spec-v3.pdf"
  );
});

test("취소하면 cancelJob을 보내고 옵션 화면으로 돌아가 남은 문단을 보인다", async ({
  page
}) => {
  await openTranslate(page, {
    // 첫 계획은 기록 없음, 취소 뒤 다시 받은 계획은 159문단이 남은 기록
    translationPlans: [
      { plan: SPEC_PLAN, once: true },
      { plan: RESUMABLE_PLAN }
    ],
    translateScripts: [{ progress: PROGRESS_TRANSLATING }]
  });
  await holdTranslate(page);
  await startTranslation(page);
  await expect(
    progressCard(page).getByText("26%", { exact: true })
  ).toBeVisible();

  await progressCard(page).getByRole("button", { name: "취소" }).click();

  await expect(progressCard(page)).toBeHidden();
  await expect(summaryCard(page).getByText(TEXT.RESUMABLE)).toBeVisible();
  await expect(
    summaryCard(page)
      .locator("dt", { hasText: "예상 입력" })
      .locator("xpath=following-sibling::dd[1]")
  ).toHaveText("약 15,700 토큰");
  await expect(statusText(page, "상태: 준비")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "새 번역", level: 1 })
  ).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

  const [request] = await translateRequests(page);
  const cancelled = (await writeCalls(page)).filter(
    (call) => call.method === "cancelJob"
  );
  expect(cancelled).toEqual([{ method: "cancelJob", jobId: request.jobId }]);
});

test("실패하면 진행 카드 자리에 원인·멈춘 곳·코드가 보이고, 다시 시도하면 같은 옵션으로 이어서 보낸다", async ({
  page
}) => {
  await openTranslate(page, {
    translationPlans: [{ plan: SPEC_PLAN }],
    translateScripts: [
      { progress: PROGRESS_TRANSLATING, failCode: "API_UNAVAILABLE" },
      { progress: [], result: SEEDED_RESULT }
    ]
  });
  await startTranslation(page);

  const failure = failureCard(page);
  await expect(failure).toBeVisible();
  await expect(progressCard(page)).toBeHidden();
  await expect(failure).toContainText(`spec-v3.pdf: ${TEXT.API_UNAVAILABLE}`);
  await expect(failure).toContainText("멈춘 곳:번역 · 3 / 14묶음");
  await expect(failure).toContainText("API_UNAVAILABLE");
  await expect(failure.getByRole("button", { name: "키 바꾸기" })).toHaveCount(
    0
  );
  await expect(failure.getByRole("button", { name: "닫기" })).toBeVisible();
  await expect(statusText(page, "상태: 오류")).toBeVisible();
  // 실패는 토스트가 아니라 이 자리에 보인다.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

  await failure.getByRole("button", { name: "다시 시도(이어서)" }).click();

  await expect(resultHeading(page)).toBeVisible();
  const requests = await translateRequests(page);
  expect(requests).toHaveLength(2);
  const [first, retry] = requests;
  expect(retry.jobId).not.toBe(first.jobId);
  expect(retry).toEqual({ ...first, jobId: retry.jobId, resume: true });
});

test("닫기는 옵션 화면으로 돌아가고, 키 오류면 '키 바꾸기'가 키 모달을 연다", async ({
  page
}) => {
  await openTranslate(page, {
    translationPlans: [{ plan: SPEC_PLAN }],
    translateScripts: [
      { progress: [], failCode: "API_KEY_INVALID" },
      { progress: [], failCode: "API_KEY_INVALID" }
    ]
  });
  await startTranslation(page);

  const failure = failureCard(page);
  await expect(failure).toContainText(`spec-v3.pdf: ${TEXT.API_KEY_INVALID}`);
  // 진행률을 받기 전에 멈췄다.
  await expect(failure).toContainText("멈춘 곳:시작 전");
  await expect(
    failure.getByRole("button", { name: "키 바꾸기" })
  ).toBeVisible();

  await failure.getByRole("button", { name: "닫기" }).click();
  await expect(failure).toBeHidden();
  await expect(summaryCard(page)).toBeVisible();
  await expect(
    summaryCard(page).getByRole("checkbox", { name: TEXT.CONSENT })
  ).not.toBeChecked();

  await startTranslation(page);
  await failure.getByRole("button", { name: "키 바꾸기" }).click();
  const keyDialog = page.getByRole("dialog", { name: "Claude API 키 등록" });
  await expect(keyDialog).toBeVisible();
  await expect(failure).toBeHidden();
  // 모달 뒤는 옵션 화면이다(저장해도 바로 시작하지 않고 동의 체크를 다시 보게 한다).
  await page.keyboard.press("Escape");
  await expect(keyDialog).toBeHidden();
  await expect(summaryCard(page)).toBeVisible();
});
