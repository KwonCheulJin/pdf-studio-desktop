import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed
} from "../src/renderer/app/providers/e2e-platform";
import type {
  GlossaryTerm,
  PageInfo,
  TranslationPlan
} from "../src/renderer/shared/api/bindings";

/**
 * 번역 옵션 화면(계획서 P6-9, 진행 가이드 Step 44, 시안 10).
 * - 파일 카드: 계획의 글자층·스캔 쪽 수와 감지 배지, 교체하면 새 문서로 다시 받는다.
 * - 옵션(원문 언어·쪽 범위·모델·문서별 용어집·스캔 페이지)을 바꾸면 실행 전 확인의 계획을 다시 받고(받는 동안 "…",
 *   늦게 온 앞 응답은 버린다), 값은 계획 응답 그대로다.
 * - 막힘 이유는 파일 → 범위 → 언어 → 번역할 것 → 키(누르면 키 모달) → 동의 순서로 하나만 보인다(계획서 §9.1.6).
 * - 외부 전송 동의(ADR 0002 §13): 설정에서 끄면 첫 번역만 확인하고, 새 키를 저장하면 다시 확인한다.
 * - 이어하기·이미 번역됨 표시, 번역 요청에 실린 옵션(공용 용어와 합친 용어집)은 `__E2E_MOCK_TRANSLATES__`로 본다.
 * 계획은 시드 `translationPlans`(옵션별)이고, 진행 화면은 Step 45다.
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

interface SeedFileParams {
  displayName: string;
  pageCount: number;
  sizeBytes: number;
}

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

/** 시안 10의 값. 예상 요금 632,100 micro USD = $0.63 */
const SPEC_PLAN: TranslationPlan = {
  pageCount: 24,
  textPages: 22,
  scanPages: 2,
  rangePages: 24,
  detectedLanguage: "zhHans",
  paragraphCount: 318,
  chunkCount: 14,
  estimatedInputTokens: 31_420,
  estimatedOutputTokens: 35_880,
  estimatedCostMicroUsd: 632_100,
  pricingDate: "2026-10-13",
  resumable: null
};

function planWith(overrides: Partial<TranslationPlan>): TranslationPlan {
  return { ...SPEC_PLAN, ...overrides };
}

/** 실행 전 확인 카드에 보일 값(계획 응답을 손으로 옮긴 글) */
interface SummaryText {
  pages: string;
  paragraphs: string;
  input: string;
  output: string;
  cost: string;
}

const SPEC_SUMMARY: SummaryText = {
  pages: "24쪽",
  paragraphs: "318개 · 14묶음",
  input: "약 31,420 토큰",
  output: "약 35,880 토큰",
  cost: "약 $0.63"
};

const SUMMARY_LABEL: Record<keyof SummaryText, string> = {
  pages: "번역할 쪽",
  paragraphs: "문단",
  input: "예상 입력",
  output: "예상 출력",
  cost: "예상 요금"
};

const TEXT = {
  NO_FILE: "번역할 PDF를 넣어 주세요.",
  INVALID_RANGE: "페이지 범위를 고치면 시작할 수 있어요.",
  UNKNOWN_LANGUAGE: "원문 언어를 골라 주세요.",
  NOTHING: "범위 안에 번역할 글이 없어요.",
  SCAN_ONLY: "스캔 페이지 옵션을 켜면 번역할 수 있어요.",
  NO_CONSENT: "전송을 확인하면 시작할 수 있어요.",
  CONSENT: "문서 내용이 번역을 위해 Anthropic API로 전송되는 것을 확인했어요.",
  CONSENT_OFF: "외부 전송 확인을 껐어요 · 설정",
  ALREADY: "이미 번역한 문서예요 · 추가 요금 없음",
  VERIFIED: "키를 확인했어요. 저장하면 번역을 시작할 수 있어요."
} as const;

/** 형식에 맞는 가짜 키(실제 키가 아니다) */
const FAKE_KEY = "sk-ant-api03-e2eFakeKeyNotReal0000-a1F3";

const SETTING_STORAGE_PREFIX = "e2e-setting:";
const SETTING = {
  CONFIRM: "translate.confirmExternalTransfer",
  CONFIRMED_ONCE: "translate.transferConfirmedOnce",
  DEFAULT_MODEL: "translate.defaultModel",
  GLOSSARY: "translate.glossary"
} as const;

const REGISTERED_KEY = { registered: true, hint: "a1F3" } as const;

interface OpenTranslateParams {
  seed?: Omit<E2eMockSeed, "files">;
  /** 첫 로드 전에 설정 저장소에 넣을 값(키 → 값) */
  settings?: Record<string, unknown>;
}

/** 시드·설정을 넣고 홈을 연다. 열기 다이얼로그는 따로 주지 않으면 `FILE_SPEC`을 고른다. */
async function openHome(
  page: Page,
  { seed = {}, settings = {} }: OpenTranslateParams
): Promise<void> {
  await page.addInitScript(
    ({ value, stored, prefix }) => {
      window.__E2E_MOCK_SEED__ = value;
      for (const [key, setting] of Object.entries(stored)) {
        localStorage.setItem(`${prefix}${key}`, JSON.stringify(setting));
      }
    },
    {
      value: {
        files: [FILE_SPEC, FILE_MANUAL],
        dialogPicks: [[FILE_SPEC.path]],
        ...seed
      },
      stored: settings,
      prefix: SETTING_STORAGE_PREFIX
    }
  );
  await page.goto("/");
}

/** 홈 번역 카드로 `FILE_SPEC`을 골라 번역 화면에 들어간다. */
async function openTranslate(
  page: Page,
  params: OpenTranslateParams = {}
): Promise<void> {
  await openHome(page, params);
  await page
    .getByRole("region", { name: "PDF 번역", exact: true })
    .getByRole("button", { name: "번역할 파일 선택" })
    .click();
  await expect(page.getByRole("heading", { name: "새 번역" })).toBeVisible();
}

function fileCard(page: Page): Locator {
  return page.getByRole("region", { name: "번역할 문서" });
}

function optionsCard(page: Page): Locator {
  return page.getByRole("region", { name: "번역 옵션" });
}

function summaryCard(page: Page): Locator {
  return page.getByRole("complementary", { name: "실행 전 확인" });
}

function summaryValue(page: Page, label: string): Locator {
  return summaryCard(page)
    .locator("dt", { hasText: label })
    .locator("xpath=following-sibling::dd[1]");
}

async function expectSummary(page: Page, text: SummaryText): Promise<void> {
  for (const key of Object.keys(SUMMARY_LABEL) as (keyof SummaryText)[]) {
    await expect(summaryValue(page, SUMMARY_LABEL[key])).toHaveText(text[key]);
  }
}

function placeholderSummary(value: string): SummaryText {
  return {
    pages: value,
    paragraphs: value,
    input: value,
    output: value,
    cost: value
  };
}

function startButton(page: Page, name = "번역 시작"): Locator {
  return summaryCard(page).getByRole("button", { name, exact: true });
}

/** 막힘 이유는 바닥에 하나만 보이고 버튼 설명이 된다. */
async function expectBlocked(page: Page, reason: string): Promise<void> {
  await expect(startButton(page)).toBeDisabled();
  await expect(startButton(page)).toHaveAccessibleDescription(reason);
}

function consentCheckbox(page: Page): Locator {
  return summaryCard(page).getByRole("checkbox", { name: TEXT.CONSENT });
}

function sourceLanguage(page: Page, name: string): Locator {
  return optionsCard(page)
    .getByRole("radiogroup", { name: "원문 언어" })
    .getByRole("radio", { name, exact: true });
}

function modelRadio(page: Page, name: RegExp): Locator {
  return optionsCard(page)
    .getByRole("radiogroup", { name: "모델" })
    .getByRole("radio", { name });
}

function rangeInput(page: Page): Locator {
  return optionsCard(page).getByLabel("페이지 범위");
}

function scanCheckbox(page: Page): Locator {
  return optionsCard(page).getByRole("checkbox", {
    name: /페이지 이미지를 읽어 번역/
  });
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

async function planRequestCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__E2E_MOCK_PLANS__?.length ?? 0);
}

async function lastPlanRequest(page: Page) {
  return page.evaluate(() => window.__E2E_MOCK_PLANS__?.slice(-1)[0]);
}

async function translateRequests(page: Page) {
  return page.evaluate(() => window.__E2E_MOCK_TRANSLATES__ ?? []);
}

async function storedSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate((storageKey) => {
    const stored = localStorage.getItem(storageKey);
    return stored === null ? null : JSON.parse(stored);
  }, `${SETTING_STORAGE_PREFIX}${key}`);
}

interface GlossaryEntry {
  number: number;
  source: string;
  target: string;
}

async function fillGlossaryRow(
  page: Page,
  { number, source, target }: GlossaryEntry
): Promise<void> {
  const card = optionsCard(page);
  await card.getByRole("button", { name: "+ 용어 추가" }).click();
  await card.getByLabel(`원어 ${number}`, { exact: true }).fill(source);
  await card.getByLabel(`번역어 ${number}`, { exact: true }).fill(target);
}

test.use({ viewport: { width: 1280, height: 800 } });

test("파일 카드에 계획의 글자층·스캔 쪽 수와 감지 배지가 보이고, 교체하면 새 문서로 다시 받는다", async ({
  page
}) => {
  await openTranslate(page, {
    seed: {
      dialogPicks: [[FILE_SPEC.path], [FILE_MANUAL.path]],
      translationPlans: [
        { match: { path: FILE_SPEC.path }, plan: SPEC_PLAN },
        {
          match: { path: FILE_MANUAL.path },
          plan: planWith({
            pageCount: 5,
            textPages: 5,
            scanPages: 0,
            rangePages: 5,
            detectedLanguage: "unknown"
          })
        }
      ]
    }
  });

  const card = fileCard(page);
  await expect(
    card.getByText("2.8 MB · 24쪽 · 글자층 22쪽 / 스캔 2쪽", { exact: true })
  ).toBeVisible();
  await expect(
    card.getByText("감지: 중국어(간체)", { exact: true })
  ).toBeVisible();
  await expect(scanCheckbox(page)).toHaveAccessibleName(
    "글자층이 없는 2쪽은 페이지 이미지를 읽어 번역 (토큰이 더 들어요)"
  );
  await expect(scanCheckbox(page)).not.toBeChecked();
  await expect(statusBar(page)).toContainText("24쪽|중국어 → 한국어");

  await card.getByRole("button", { name: "교체" }).click();

  await expect(
    card.getByText("20 KB · 5쪽 · 글자층 5쪽 / 스캔 0쪽", { exact: true })
  ).toBeVisible();
  await expect(
    card.getByText("언어를 알 수 없어요", { exact: true })
  ).toBeVisible();
  await expect(optionsCard(page).getByText("스캔 쪽 없음")).toBeVisible();
  await expect(scanCheckbox(page)).toHaveCount(0);
  await expect(optionsCard(page).getByText("/ 5쪽")).toBeVisible();
  // 언어를 모르면 상태바에 언어 쌍이 없다.
  await expect(statusBar(page)).not.toContainText("→");
  expect((await lastPlanRequest(page))?.path).toBe(FILE_MANUAL.path);
});

test("실행 전 확인 값은 계획 응답 그대로이고, 옵션을 바꿀 때마다 쌓인 옵션으로 계획을 다시 받는다", async ({
  page
}) => {
  // 앞에서부터 처음 맞는 시드를 쓴다. 바꾼 옵션이 쌓이므로 나중에 바꿀 옵션의 시드를 앞에 둔다.
  const plans = {
    glossary: planWith({ paragraphCount: 300, chunkCount: 10 }),
    scan: planWith({ paragraphCount: 6, chunkCount: 3, rangePages: 5 }),
    haiku: planWith({
      paragraphCount: 4,
      chunkCount: 1,
      rangePages: 5,
      estimatedInputTokens: 900,
      estimatedOutputTokens: 1_100,
      estimatedCostMicroUsd: 6_400
    }),
    range: planWith({
      rangePages: 5,
      paragraphCount: 4,
      chunkCount: 1,
      estimatedInputTokens: 1_200,
      estimatedOutputTokens: 1_500,
      estimatedCostMicroUsd: 29_100
    }),
    english: planWith({
      detectedLanguage: "en",
      estimatedInputTokens: 28_000,
      estimatedOutputTokens: 41_000,
      estimatedCostMicroUsd: 1_234_567
    })
  };
  await openTranslate(page, {
    seed: {
      translationPlans: [
        { match: { glossaryCount: 1 }, plan: plans.glossary },
        { match: { includeScanPages: true }, plan: plans.scan },
        { match: { model: "haiku" }, plan: plans.haiku },
        { match: { range: "1-5" }, plan: plans.range },
        { match: { sourceLanguage: "en" }, plan: plans.english },
        { plan: SPEC_PLAN }
      ]
    }
  });

  await expectSummary(page, SPEC_SUMMARY);
  await expect(summaryCard(page)).toContainText("요금표 기준일 2026-10-13.");
  await expect(sourceLanguage(page, "자동 감지")).toBeChecked();
  await expect(modelRadio(page, /^Sonnet 5\.5/)).toBeChecked();
  expect((await lastPlanRequest(page))?.options).toEqual({
    sourceLanguage: "auto",
    range: "",
    includeScanPages: false,
    model: "sonnet",
    glossary: []
  });

  await sourceLanguage(page, "영어").click();
  await expectSummary(page, {
    ...SPEC_SUMMARY,
    input: "약 28,000 토큰",
    output: "약 41,000 토큰",
    cost: "약 $1.23"
  });

  await rangeInput(page).fill("1-5");
  await expectSummary(page, {
    pages: "5쪽",
    paragraphs: "4개 · 1묶음",
    input: "약 1,200 토큰",
    output: "약 1,500 토큰",
    cost: "약 $0.03"
  });

  await modelRadio(page, /^Haiku 5\.5/).check();
  await expectSummary(page, {
    pages: "5쪽",
    paragraphs: "4개 · 1묶음",
    input: "약 900 토큰",
    output: "약 1,100 토큰",
    cost: "$0.01 미만"
  });

  await scanCheckbox(page).click();
  await expect(summaryValue(page, "문단")).toHaveText("6개 · 3묶음");

  // 원어만 쓴 용어는 실리지 않아 계획을 다시 받지 않는다. 번역어까지 쓰면 다시 받는다.
  await optionsCard(page).getByRole("button", { name: "+ 용어 추가" }).click();
  await optionsCard(page)
    .getByLabel("원어 1", { exact: true })
    .fill("额定电压");
  const requestsBeforeTarget = await planRequestCount(page);
  await optionsCard(page)
    .getByLabel("번역어 1", { exact: true })
    .fill("정격 전압");
  await expect(summaryValue(page, "문단")).toHaveText("300개 · 10묶음");
  expect(await planRequestCount(page)).toBe(requestsBeforeTarget + 1);

  expect((await lastPlanRequest(page))?.options).toEqual({
    sourceLanguage: "en",
    range: "1-5",
    includeScanPages: true,
    model: "haiku",
    glossary: [{ source: "额定电压", target: "정격 전압" }]
  });
});

test("계획을 받는 동안 숫자 자리는 …이고, 늦게 온 앞 응답은 버린다", async ({
  page
}) => {
  await openTranslate(page, {
    seed: {
      apiKey: REGISTERED_KEY,
      translationPlans: [
        {
          match: { sourceLanguage: "en" },
          plan: planWith({ paragraphCount: 111, chunkCount: 1 })
        },
        {
          match: { sourceLanguage: "zh" },
          plan: planWith({ paragraphCount: 222, chunkCount: 2 })
        },
        { plan: SPEC_PLAN }
      ]
    }
  });
  await expectSummary(page, SPEC_SUMMARY);

  await page.evaluate(() => {
    window.__E2E_HOLD_PLAN__ = new Promise((resolve) => {
      window.__E2E_RELEASE_PLAN__ = resolve;
    });
  });
  await sourceLanguage(page, "영어").click();
  await expectSummary(page, placeholderSummary("…"));
  await expect(startButton(page)).toBeDisabled();

  // 붙잡기를 거둔 뒤의 요청(중국어)은 바로 온다. 그 뒤에 앞 요청(영어)을 풀어도 화면은 중국어 계획이다.
  await page.evaluate(() => {
    window.__E2E_HOLD_PLAN__ = undefined;
  });
  await sourceLanguage(page, "중국어").click();
  await expect(summaryValue(page, "문단")).toHaveText("222개 · 2묶음");
  const settledBefore = await page.evaluate(
    () => window.__E2E_MOCK_PLANS_SETTLED__ ?? 0
  );
  await page.evaluate(() => window.__E2E_RELEASE_PLAN__?.());
  await expect
    .poll(() => page.evaluate(() => window.__E2E_MOCK_PLANS_SETTLED__ ?? 0))
    .toBe(settledBefore + 1);
  await expect(summaryValue(page, "문단")).toHaveText("222개 · 2묶음");
  await expect(sourceLanguage(page, "중국어")).toBeChecked();
});

test("막힘 이유는 파일 → 범위 → 언어 → 번역할 것 → 키 → 동의 순서로 하나만 보이고, 키 없이 시작하면 키 모달이 뜬다", async ({
  page
}) => {
  // 병합 카드로 문서를 넣은 뒤 모드 탭으로 들어오면 번역 문서가 없다.
  await openHome(page, {
    seed: {
      dialogPicks: [[FILE_MANUAL.path], [FILE_SPEC.path]],
      apiKeyChecks: [null],
      translationPlans: [
        {
          match: { sourceLanguage: "zh", range: "3", includeScanPages: true },
          plan: planWith({ chunkCount: 0, paragraphCount: 0, rangePages: 1 })
        },
        {
          match: { sourceLanguage: "zh", range: "3" },
          plan: planWith({ chunkCount: 0, paragraphCount: 0, rangePages: 1 })
        },
        { match: { sourceLanguage: "zh" }, plan: SPEC_PLAN },
        {
          plan: planWith({
            detectedLanguage: "unknown",
            estimatedInputTokens: 0,
            estimatedOutputTokens: 0,
            estimatedCostMicroUsd: 0
          })
        }
      ]
    }
  });
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await page
    .getByRole("tablist", { name: "작업 모드" })
    .getByRole("tab", { name: "번역", exact: true })
    .click();

  await expectBlocked(page, TEXT.NO_FILE);
  await expectSummary(page, placeholderSummary("—"));

  await fileCard(page)
    .getByRole("button", { name: /^PDF 고르기/ })
    .click();
  await expect(fileCard(page)).toContainText(FILE_SPEC.displayName);

  // 범위 오류가 언어 모름보다 먼저다.
  await rangeInput(page).fill("30");
  await expectBlocked(page, TEXT.INVALID_RANGE);
  await expect(
    optionsCard(page).getByText("이 문서는 24쪽까지 있어요. 범위를 줄이세요.")
  ).toBeVisible();
  await expect(rangeInput(page)).toHaveAttribute("aria-invalid", "true");
  await rangeInput(page).fill("5-3");
  await expect(
    optionsCard(page).getByText("구간은 작은 쪽부터 써 주세요(예: 3-5).")
  ).toBeVisible();
  await rangeInput(page).fill("1,,2");
  await expect(
    optionsCard(page).getByText("쪽 번호는 1부터 1,3-5처럼 써 주세요.")
  ).toBeVisible();
  await expectSummary(page, placeholderSummary("—"));

  await rangeInput(page).fill("3");
  await expectBlocked(page, TEXT.UNKNOWN_LANGUAGE);
  await expect(summaryValue(page, "예상 입력")).toHaveText("—");

  await sourceLanguage(page, "중국어").click();
  await expectBlocked(page, TEXT.SCAN_ONLY);
  await scanCheckbox(page).click();
  await expectBlocked(page, TEXT.NOTHING);

  await rangeInput(page).fill("");
  await expectSummary(page, SPEC_SUMMARY);
  // 키가 없으면 버튼은 켜져 있고(이유 없음) 누르면 키 모달이 뜬다.
  await expect(startButton(page)).toBeEnabled();
  await expect(startButton(page)).toHaveAccessibleDescription("");
  await expect(summaryCard(page).getByText("API 키 없음")).toBeVisible();
  await startButton(page).click();
  const keyDialog = page.getByRole("dialog", { name: "Claude API 키 등록" });
  await expect(keyDialog).toBeVisible();
  await keyDialog.getByLabel("API 키", { exact: true }).fill(FAKE_KEY);
  await expect(keyDialog.getByText(TEXT.VERIFIED)).toBeVisible();
  await keyDialog.getByRole("button", { name: "저장" }).click();

  // 저장하면 모달이 닫히고 옵션 화면에 남는다(바로 시작하지 않는다).
  await expect(keyDialog).toBeHidden();
  await expect(summaryCard(page).getByText("API 키 등록됨")).toBeVisible();
  await expect(summaryCard(page).getByText("····a1F3")).toBeVisible();
  await expectBlocked(page, TEXT.NO_CONSENT);
  expect(await translateRequests(page)).toEqual([]);

  await consentCheckbox(page).check();
  await expect(startButton(page)).toBeEnabled();
  await expect(startButton(page)).toHaveAccessibleDescription("");
  await startButton(page).click();
  await expect.poll(async () => (await translateRequests(page)).length).toBe(1);
});

test("설정에서 외부 전송 확인을 끄면 키 등록 뒤 첫 번역만 확인하고, 그 뒤로는 끈 표시와 설정 링크가 보인다", async ({
  page
}) => {
  await openTranslate(page, {
    seed: { apiKey: REGISTERED_KEY, translationPlans: [{ plan: SPEC_PLAN }] },
    settings: { [SETTING.CONFIRM]: false }
  });

  // 첫 번역(`transferConfirmedOnce` 없음)은 끈 설정이어도 확인을 받는다.
  await expectBlocked(page, TEXT.NO_CONSENT);
  await expect(summaryCard(page).getByText(TEXT.CONSENT_OFF)).toHaveCount(0);
  await consentCheckbox(page).check();
  await startButton(page).click();
  await expect.poll(async () => (await translateRequests(page)).length).toBe(1);
  expect(await storedSetting(page, SETTING.CONFIRMED_ONCE)).toBe(true);

  // 한 번 확인한 뒤에는 체크 없이 시작하고, 끈 표시가 보인다.
  await expect(consentCheckbox(page)).toHaveCount(0);
  await expect(summaryCard(page).getByText(TEXT.CONSENT_OFF)).toBeVisible();
  await expect(startButton(page)).toBeEnabled();
  await startButton(page).click();
  await expect.poll(async () => (await translateRequests(page)).length).toBe(2);

  // "설정"은 설정 모달을 번역 탭으로 연다. 확인을 다시 켜면 체크를 받는다.
  await summaryCard(page)
    .getByRole("button", { name: "번역 설정 열기" })
    .click();
  const settings = page.getByRole("dialog", { name: "설정" });
  await expect(
    settings.getByRole("tab", { name: "번역", exact: true })
  ).toHaveAttribute("aria-selected", "true");
  await settings
    .getByRole("checkbox", { name: "번역 전에 외부 전송 확인 받기" })
    .check();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expectBlocked(page, TEXT.NO_CONSENT);
  await expect(summaryCard(page).getByText(TEXT.CONSENT_OFF)).toHaveCount(0);
});

test("확인을 켜 두면 한 번 확인한 뒤에도 늘 체크를 받고, 시작하면 체크를 비운다", async ({
  page
}) => {
  await openTranslate(page, {
    seed: { apiKey: REGISTERED_KEY, translationPlans: [{ plan: SPEC_PLAN }] },
    settings: { [SETTING.CONFIRMED_ONCE]: true }
  });

  await expectBlocked(page, TEXT.NO_CONSENT);
  await consentCheckbox(page).check();
  await startButton(page).click();
  await expect.poll(async () => (await translateRequests(page)).length).toBe(1);
  await expect(consentCheckbox(page)).not.toBeChecked();
  await expectBlocked(page, TEXT.NO_CONSENT);
});

test("새 키를 저장하면 외부 전송 확인을 다시 받는다", async ({ page }) => {
  await openTranslate(page, {
    seed: {
      apiKey: REGISTERED_KEY,
      apiKeyChecks: [null],
      translationPlans: [{ plan: SPEC_PLAN }]
    },
    settings: { [SETTING.CONFIRM]: false, [SETTING.CONFIRMED_ONCE]: true }
  });
  await expect(summaryCard(page).getByText(TEXT.CONSENT_OFF)).toBeVisible();
  await expect(startButton(page)).toBeEnabled();

  await summaryCard(page).getByRole("button", { name: "바꾸기" }).click();
  const keyDialog = page.getByRole("dialog", { name: "Claude API 키 등록" });
  await keyDialog.getByLabel("API 키", { exact: true }).fill(FAKE_KEY);
  await expect(keyDialog.getByText(TEXT.VERIFIED)).toBeVisible();
  await keyDialog.getByRole("button", { name: "저장" }).click();
  await expect(keyDialog).toBeHidden();

  await expectBlocked(page, TEXT.NO_CONSENT);
  await expect(consentCheckbox(page)).toBeVisible();
  expect(await storedSetting(page, SETTING.CONFIRMED_ONCE)).toBe(false);
});

test("이어하기 기록이 있으면 남은 문단을, 모두 번역됐으면 '이미 번역한 문서예요'와 동의 없는 '결과 보기'를 보인다", async ({
  page
}) => {
  await openTranslate(page, {
    seed: {
      apiKey: REGISTERED_KEY,
      translationPlans: [
        {
          match: { model: "haiku" },
          plan: planWith({
            estimatedInputTokens: 0,
            estimatedOutputTokens: 0,
            estimatedCostMicroUsd: 0,
            resumable: { translatedParagraphs: 318, paragraphCount: 318 }
          })
        },
        {
          plan: planWith({
            estimatedInputTokens: 15_700,
            estimatedOutputTokens: 17_900,
            estimatedCostMicroUsd: 315_000,
            resumable: { translatedParagraphs: 159, paragraphCount: 318 }
          })
        }
      ]
    }
  });

  await expect(
    summaryCard(page).getByText(
      "번역한 문단 159 / 318개가 남아 있어요. 번역 시작하면 이어서 해요."
    )
  ).toBeVisible();
  await expect(summaryValue(page, "예상 입력")).toHaveText("약 15,700 토큰");
  await expectBlocked(page, TEXT.NO_CONSENT);

  await modelRadio(page, /^Haiku 5\.5/).check();
  await expect(summaryCard(page).getByText(TEXT.ALREADY)).toBeVisible();
  await expect(summaryValue(page, "예상 요금")).toHaveText("약 $0.00");
  await expect(consentCheckbox(page)).toHaveCount(0);
  await expect(startButton(page, "결과 보기")).toBeEnabled();
  await startButton(page, "결과 보기").click();

  await expect.poll(async () => (await translateRequests(page)).length).toBe(1);
  const [request] = await translateRequests(page);
  expect(request.resume).toBe(true);
  expect(request.options.model).toBe("haiku");
  // 보낼 것이 없으므로 외부 전송 확인 기록을 남기지 않는다.
  expect(await storedSetting(page, SETTING.CONFIRMED_ONCE)).toBeNull();
});

test("번역 요청에 고른 옵션과 합친 용어집(문서별 먼저·정규화)이 실리고, 모델은 설정의 기본 모델을 따라간다", async ({
  page
}) => {
  const sharedGlossary: GlossaryTerm[] = [
    { source: "保修", target: "보증" },
    { source: "额定电压", target: "공용 전압" },
    { source: " ", target: "빈 원어" }
  ];
  await openTranslate(page, {
    seed: { apiKey: REGISTERED_KEY, translationPlans: [{ plan: SPEC_PLAN }] },
    settings: {
      [SETTING.DEFAULT_MODEL]: "haiku",
      [SETTING.GLOSSARY]: sharedGlossary
    }
  });

  await expect(modelRadio(page, /^Haiku 5\.5/)).toBeChecked();
  await expect
    .poll(async () => (await lastPlanRequest(page))?.options.model)
    .toBe("haiku");
  await expect(
    optionsCard(page).getByText(
      "제품명·고유명사를 정해 두면 문서 전체에서 같게 번역해요. · 공용 용어 2개도 함께 적용해요"
    )
  ).toBeVisible();

  // 고르지 않았으면 설정의 기본 모델을 따라간다.
  await page.keyboard.press("Meta+Comma");
  const settings = page.getByRole("dialog", { name: "설정" });
  await settings.getByRole("tab", { name: "번역", exact: true }).click();
  await settings
    .getByRole("radiogroup", { name: "기본 모델" })
    .getByRole("radio", { name: "Sonnet 5.5 (권장)" })
    .click();
  await page.keyboard.press("Escape");
  await expect(modelRadio(page, /^Sonnet 5\.5/)).toBeChecked();
  await expect
    .poll(async () => (await lastPlanRequest(page))?.options.model)
    .toBe("sonnet");

  // 문서별 용어: 앞뒤 공백·빈 행·같은 원어(뒤의 것)는 실리지 않고, 지운 행은 빠진다.
  await fillGlossaryRow(page, {
    number: 1,
    source: " 额定电压 ",
    target: "정격 전압"
  });
  await fillGlossaryRow(page, {
    number: 2,
    source: "PS-200 控制器",
    target: "PS-200 컨트롤러"
  });
  await fillGlossaryRow(page, {
    number: 3,
    source: "额定电压",
    target: "중복"
  });
  await optionsCard(page).getByRole("button", { name: "+ 용어 추가" }).click();
  await fillGlossaryRow(page, {
    number: 5,
    source: "说明书",
    target: "설명서"
  });
  await expect(
    optionsCard(page).getByText(
      "빈 칸이 있거나 앞에 같은 원어가 있는 용어(흐리게 표시)는 적용하지 않아요."
    )
  ).toBeVisible();
  await optionsCard(page)
    .getByRole("button", { name: "용어 지우기" })
    .nth(1)
    .click();
  await expect(
    optionsCard(page).getByLabel("원어 2", { exact: true })
  ).toHaveValue("额定电压");

  await modelRadio(page, /^Haiku 5\.5/).check();
  await sourceLanguage(page, "중국어").click();
  await rangeInput(page).fill("1-3");
  await scanCheckbox(page).click();
  // 설정의 기본 모델을 바꿔도 직접 고른 모델은 그대로다.
  await page.keyboard.press("Meta+Comma");
  await settings.getByRole("tab", { name: "번역", exact: true }).click();
  await settings
    .getByRole("radiogroup", { name: "기본 모델" })
    .getByRole("radio", { name: "Sonnet 5.5 (권장)" })
    .click();
  await page.keyboard.press("Escape");
  await expect(modelRadio(page, /^Haiku 5\.5/)).toBeChecked();

  await expectSummary(page, SPEC_SUMMARY);
  await consentCheckbox(page).check();
  await startButton(page).click();

  await expect.poll(async () => (await translateRequests(page)).length).toBe(1);
  const [request] = await translateRequests(page);
  expect(request.path).toBe(FILE_SPEC.path);
  expect(request.resume).toBe(true);
  expect(request.jobId).toMatch(/^[0-9a-f-]{36}$/);
  expect(request.options).toEqual({
    sourceLanguage: "zh",
    range: "1-3",
    includeScanPages: true,
    model: "haiku",
    glossary: [
      { source: "额定电压", target: "정격 전압" },
      { source: "说明书", target: "설명서" },
      { source: "保修", target: "보증" }
    ]
  });
  // 요청 옵션과 실행 전 확인의 마지막 계획 요청이 같다(같은 옵션으로 계획을 받았다).
  expect((await lastPlanRequest(page))?.options).toEqual(request.options);
});

test("번역을 시작하면 실행 상태가 되어 버튼이 막히고, 끝나면 계획을 다시 받는다", async ({
  page
}) => {
  await openTranslate(page, {
    seed: {
      apiKey: REGISTERED_KEY,
      translationPlans: [
        {
          match: { model: "sonnet" },
          plan: planWith({ resumable: null })
        }
      ]
    },
    // 동의 체크가 없어도 시작할 수 있는 상태: 실행 중에 버튼을 막는 것은 실행 상태뿐이다.
    settings: { [SETTING.CONFIRM]: false, [SETTING.CONFIRMED_ONCE]: true }
  });
  await expectSummary(page, SPEC_SUMMARY);
  await page.evaluate(() => {
    window.__E2E_HOLD_TRANSLATE__ = new Promise((resolve) => {
      window.__E2E_RELEASE_TRANSLATE__ = resolve;
    });
  });
  const plansBefore = await planRequestCount(page);

  await startButton(page).click();
  await expect(startButton(page, "번역하는 중…")).toBeDisabled();
  await expect.poll(async () => (await translateRequests(page)).length).toBe(1);

  await page.evaluate(() => window.__E2E_RELEASE_TRANSLATE__?.());
  await expect(startButton(page)).toBeVisible();
  // 번역이 기록을 바꿨으니 같은 옵션이어도 계획을 다시 받는다.
  await expect.poll(() => planRequestCount(page)).toBe(plansBefore + 1);
  expect((await lastPlanRequest(page))?.path).toBe(FILE_SPEC.path);
});
