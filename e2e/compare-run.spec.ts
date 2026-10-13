import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eCompareScript,
  E2eMockFile,
  E2eMockSeed
} from "../src/renderer/app/providers/e2e-platform";
import type {
  Change,
  CompareProgress,
  CompareRequest,
  CompareResult,
  PageInfo
} from "../src/renderer/shared/api/bindings";
import type { NativeFileDropEvent } from "../src/renderer/shared/platform";

/**
 * 비교 실행 전 옵션과 진행 화면(계획서 P3-3·P3-3a, 진행 가이드 Step 26, 시안 3 아래·9).
 * - 페이지 범위는 A·B 따로 검사하고, 틀리면 빨간 테두리·이유 문구와 실행 버튼 막기
 * - 비교 대상(글자·대소문자), 반복 줄 제외, 요약 배지, "기본값으로", 카드 접기
 * - 실행하면 진행 카드(전체 %·6개 작업 행), 끝나면 결과 화면(자세한 확인은 compare-result.spec.ts), 취소하면 옵션 화면
 * - 다른 모드로 가도 작업은 계속되고 상태바에 "비교 중 N%"
 *
 * 진행률은 시드(`compareScripts`)의 손으로 셈한 `CompareProgress`(Rust 실행기와 같은 공식,
 * ADR 0001 §15)로 보내고, `__E2E_HOLD_COMPARE__`로 진행 화면을 붙잡아 본다.
 */

const FIXTURE_BYTES = readFileSync(
  path.join(__dirname, "fixtures", "three-pages.pdf")
).toString("base64");

/** 결과 시드는 Rust golden(`diff-edit` 변경)을 그대로 쓴다(ADR 0001 §7). */
const GOLDEN_CHANGES: Change[] = JSON.parse(
  readFileSync(
    path.join(
      __dirname,
      "..",
      "crates",
      "pdf-core",
      "tests",
      "golden",
      "diff-edit.changes.json"
    ),
    "utf8"
  )
);

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
}

function seedFile({ displayName, pageCount }: SeedFileParams): E2eMockFile {
  return {
    path: `/Users/e2e/originals/${displayName}`,
    displayName,
    pages: Array.from({ length: pageCount }, () => A4_PAGE),
    sizeBytes: 1_153_434,
    bytesBase64: FIXTURE_BYTES
  };
}

const FILE_V1 = seedFile({ displayName: "contract-v1.pdf", pageCount: 18 });
const FILE_V2 = seedFile({ displayName: "contract-v2.pdf", pageCount: 19 });
const FILE_V3 = seedFile({ displayName: "contract-v3.pdf", pageCount: 4 });

const ALL_FILES = [FILE_V1, FILE_V2, FILE_V3];

const JOB_PLACEHOLDER = "e2e";

type ProgressStep = Omit<CompareProgress, "jobId" | "detail"> &
  Partial<Pick<CompareProgress, "detail">>;

/** 진행률 시드. `jobId`는 mock이 쓰지 않아(앱은 단계·% 만 본다) 자리 값으로 둔다. */
function progress(steps: ProgressStep[]): CompareProgress[] {
  return steps.map((step) => ({
    jobId: JOB_PLACEHOLDER,
    detail: null,
    ...step
  }));
}

/**
 * A 18쪽 읽기 끝(20%) → B 19쪽 중 12쪽(단계 ⌊1200/19⌋ = 63, 전체 ⌊(20×100 + 63×20)/100⌋ = 32)
 */
const PROGRESS_READING_B = progress([
  {
    stage: "extractA",
    done: 0,
    total: 18,
    stagePercent: 0,
    overallPercent: 0
  },
  {
    stage: "extractA",
    done: 18,
    total: 18,
    stagePercent: 100,
    overallPercent: 20
  },
  {
    stage: "extractB",
    done: 0,
    total: 19,
    stagePercent: 0,
    overallPercent: 20
  },
  {
    stage: "extractB",
    done: 12,
    total: 19,
    stagePercent: 63,
    overallPercent: 32
  }
]);

/**
 * A는 앞선 실행의 캐시로 바로 100%(20) → B 읽기 끝(40) → 스캔 쪽 10쪽 중 3쪽
 * (단계 30, 전체 ⌊(40×100 + 30×30)/100⌋ = 49)
 */
const PROGRESS_SCANNING = progress([
  {
    stage: "extractA",
    done: 18,
    total: 18,
    stagePercent: 100,
    overallPercent: 20,
    detail: "cached"
  },
  {
    stage: "extractB",
    done: 0,
    total: 19,
    stagePercent: 0,
    overallPercent: 20
  },
  {
    stage: "extractB",
    done: 19,
    total: 19,
    stagePercent: 100,
    overallPercent: 40
  },
  { stage: "ocr", done: 0, total: 10, stagePercent: 0, overallPercent: 40 },
  { stage: "ocr", done: 3, total: 10, stagePercent: 30, overallPercent: 49 }
]);

const A4_SIZE = {
  viewBox: A4_PAGE.cropBox,
  rotation: A4_PAGE.rotation
};

/** golden 변경 7개 중 첫째만 확인 필요로 바꾼 결과: 차이 6 · 확인 필요 1 */
const SEEDED_RESULT: CompareResult = {
  changes: GOLDEN_CHANGES.map((change, index) =>
    index === 0 ? { ...change, needsReview: true } : change
  ),
  pagePairs: [
    [0, 0],
    [1, 1]
  ],
  pageSizes: {
    before: Array.from({ length: FILE_V1.pages.length }, () => A4_SIZE),
    after: Array.from({ length: FILE_V2.pages.length }, () => A4_SIZE)
  },
  pageSources: {
    before: FILE_V1.pages.map(() => "textLayer"),
    after: FILE_V2.pages.map(() => "textLayer")
  },
  notices: []
};

async function openHome(
  page: Page,
  seed: Omit<E2eMockSeed, "files">
): Promise<void> {
  await page.addInitScript(
    (initialSeed) => {
      window.__E2E_MOCK_SEED__ = initialSeed;
    },
    { files: ALL_FILES, ...seed }
  );
  await page.goto("/");
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

/** 홈 비교 카드에 두 파일(A 18쪽, B 19쪽)을 놓아 비교 화면으로 들어간다. */
async function openComparePair(
  page: Page,
  seed: Omit<E2eMockSeed, "files"> = {}
): Promise<void> {
  await openHome(page, seed);
  const card = page.getByRole("region", { name: "PDF 비교", exact: true });
  const box = await card.boundingBox();
  if (!box) {
    throw new Error("홈 비교 카드가 화면에 없습니다.");
  }
  const position = {
    x: (box.x + box.width / 2) * DEVICE_PIXEL_RATIO,
    y: (box.y + box.height / 2) * DEVICE_PIXEL_RATIO
  };
  const paths = [FILE_V1.path, FILE_V2.path];
  await dropFiles(page, { type: "enter", paths, position });
  await dropFiles(page, { type: "drop", paths, position });
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
  await expect(statusBar(page)).toContainText(/A 18쪽\s*\|\s*B 19쪽/);
}

async function holdCompare(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__E2E_HOLD_COMPARE__ = new Promise<void>((resolve) => {
      window.__E2E_RELEASE_COMPARE__ = resolve;
    });
  });
}

async function releaseCompare(page: Page): Promise<void> {
  await page.evaluate(() => window.__E2E_RELEASE_COMPARE__?.());
}

async function readCompareRequests(page: Page): Promise<CompareRequest[]> {
  return page.evaluate(() => window.__E2E_MOCK_COMPARES__ ?? []);
}

async function readCancelledJobs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window.__E2E_MOCK_WRITES__ ?? []).flatMap((call) =>
      call.method === "cancelJob" ? [call.jobId] : []
    )
  );
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

function optionsCard(page: Page): Locator {
  return page.getByRole("region", { name: "실행 전 옵션" });
}

function rangeInput(page: Page, badge: string): Locator {
  return page.getByRole("textbox", { name: `${badge} 페이지 범위` });
}

function runButton(page: Page): Locator {
  return page.getByRole("button", { name: "비교 실행" });
}

function resetButton(page: Page): Locator {
  return page.getByRole("button", { name: "기본값으로" });
}

function progressCard(page: Page): Locator {
  return page.getByRole("region", { name: "전체 진행률" });
}

function stageRows(page: Page): Locator {
  return page.getByRole("list", { name: "작업별 진행" }).getByRole("listitem");
}

function stageRow(page: Page, label: string): Locator {
  return stageRows(page).filter({ hasText: label });
}

function stageBar(page: Page, label: string): Locator {
  return page.getByRole("progressbar", { name: `${label} 진행률` });
}

/** 결과 화면 제목 "A → B" */
function resultHeading(page: Page): Locator {
  return page.getByRole("heading", {
    name: `${FILE_V1.displayName} → ${FILE_V2.displayName}`
  });
}

function compareStatus(page: Page, text: string): Locator {
  return page.getByRole("status").filter({ hasText: text });
}

function modeTab(page: Page, label: string): Locator {
  return page
    .getByRole("tablist", { name: "작업 모드" })
    .getByRole("tab", { name: label, exact: true });
}

function toast(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

test("문서를 다 넣어야 실행할 수 있고, 바닥 줄이 빠진 문서를 알린다", async ({
  page
}) => {
  await openHome(page, { dialogPicks: [[FILE_V3.path], [FILE_V1.path]] });
  await page
    .getByRole("region", { name: "PDF 병합", exact: true })
    .getByRole("button", { name: "파일 선택", exact: true })
    .click();
  await modeTab(page, "비교").click();

  await expect(
    optionsCard(page).getByText("A·B 문서를 넣으면 실행할 수 있어요.")
  ).toBeVisible();
  await expect(runButton(page)).toBeDisabled();

  await page
    .getByRole("group", { name: "이전 문서", exact: true })
    .getByRole("button", { name: /^PDF 고르기/ })
    .click();

  await expect(
    optionsCard(page).getByText("B 문서를 넣으면 실행할 수 있어요.")
  ).toBeVisible();
  await expect(runButton(page)).toBeDisabled();
  await expect(page.getByText("/ 18쪽")).toBeVisible();
});

test("페이지 범위는 A·B 따로 검사해 이유를 보이고, 고치면 비교할 쪽수를 보이며 실행할 수 있다", async ({
  page
}) => {
  await openComparePair(page);
  const card = optionsCard(page);

  await expect(card.getByText("A 18쪽 · B 19쪽을 비교해요")).toBeVisible();
  await expect(runButton(page)).toBeEnabled();
  await expect(card.getByText("/ 18쪽")).toBeVisible();
  await expect(card.getByText("/ 19쪽")).toBeVisible();
  await expect(card.getByText("전체 쪽", { exact: true })).toBeVisible();

  await rangeInput(page, "B").fill("1-25");

  await expect(
    card.getByText("B 문서는 19쪽까지 있어요. 범위를 줄이세요.")
  ).toBeVisible();
  await expect(rangeInput(page, "B")).toHaveAttribute("aria-invalid", "true");
  await expect(rangeInput(page, "B")).toHaveAccessibleDescription(
    "B 문서는 19쪽까지 있어요. 범위를 줄이세요."
  );
  await expect(
    card.getByText("B의 페이지 범위를 고치면 실행할 수 있어요.")
  ).toBeVisible();
  await expect(runButton(page)).toBeDisabled();
  await expect(card.getByText("범위 지정", { exact: true })).toBeVisible();

  await rangeInput(page, "A").fill("3-1");
  await expect(
    card.getByText("구간은 작은 쪽부터 써 주세요(예: 3-5).")
  ).toBeVisible();
  await expect(
    card.getByText("A·B의 페이지 범위를 고치면 실행할 수 있어요.")
  ).toBeVisible();

  await rangeInput(page, "A").fill("1,,2");
  await expect(
    card.getByText("쪽 번호는 1부터 1,3-5처럼 써 주세요.")
  ).toBeVisible();

  // 겹치거나 뒤바뀐 항목은 받아 준다(Rust `parse_page_range`와 같다): 1, 3, 4, 5쪽
  await rangeInput(page, "A").fill(" 5, 1 , 3-4,4");
  await rangeInput(page, "B").fill("1-5");

  await expect(card.getByText(/페이지 범위를 고치면/)).toHaveCount(0);
  await expect(rangeInput(page, "B")).toHaveAttribute("aria-invalid", "false");
  await expect(card.getByText("A 4쪽 · B 5쪽을 비교해요")).toBeVisible();
  await expect(runButton(page)).toBeEnabled();
});

test("비교 대상·반복 줄 제외는 요약 배지에 보이고, 기본값으로 되돌리며, 카드를 접어도 실행 줄은 남는다", async ({
  page
}) => {
  await openComparePair(page);
  const card = optionsCard(page);

  await expect(resetButton(page)).toBeDisabled();
  await expect(card.getByText("글자 비교", { exact: true })).toBeVisible();
  await expect(card.getByText("제외 없음", { exact: true })).toBeVisible();
  await expect(card.getByText("1 / 4 켬")).toBeVisible();
  await expect(card.getByText(/0 \/ 3 뺌/)).toBeVisible();
  for (const upcoming of ["스타일", "레이아웃", "그림"]) {
    await expect(
      card.getByRole("checkbox", { name: upcoming, exact: true })
    ).toBeDisabled();
  }
  await expect(card.getByText("준비 중", { exact: true })).toHaveCount(3);

  await card.getByRole("checkbox", { name: "머리말" }).click();
  await card.getByText("꼬리말", { exact: true }).click();
  await card.getByRole("checkbox", { name: "대소문자" }).click();

  await expect(card.getByText("2줄 제외", { exact: true })).toBeVisible();
  await expect(card.getByText(/2 \/ 3 뺌/)).toBeVisible();
  await expect(card.getByRole("checkbox", { name: "꼬리말" })).toBeChecked();
  await expect(resetButton(page)).toBeEnabled();

  // 글자를 끄면 비교할 대상이 없어 실행할 수 없고, 하위 옵션도 막힌다.
  await card.getByRole("checkbox", { name: "글자", exact: true }).click();
  await expect(card.getByText("0 / 4 켬")).toBeVisible();
  await expect(card.getByText("대상 없음", { exact: true })).toBeVisible();
  await expect(
    card.getByText("비교 대상을 켜면 실행할 수 있어요.")
  ).toBeVisible();
  await expect(runButton(page)).toBeDisabled();
  await expect(card.getByRole("checkbox", { name: "대소문자" })).toBeDisabled();

  await rangeInput(page, "A").fill("2-3");
  await resetButton(page).click();

  await expect(resetButton(page)).toBeDisabled();
  await expect(rangeInput(page, "A")).toHaveValue("");
  await expect(
    card.getByRole("checkbox", { name: "글자", exact: true })
  ).toBeChecked();
  for (const name of ["머리말", "꼬리말", "쪽번호", "대소문자"]) {
    await expect(card.getByRole("checkbox", { name })).not.toBeChecked();
  }
  await expect(card.getByText("제외 없음", { exact: true })).toBeVisible();
  await expect(runButton(page)).toBeEnabled();

  const toggle = card.getByRole("button", { name: "실행 전 옵션" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(rangeInput(page, "A")).toBeHidden();
  await expect(card.getByText("글자 비교", { exact: true })).toBeVisible();
  await expect(runButton(page)).toBeEnabled();
  await toggle.click();
  await expect(rangeInput(page, "A")).toBeVisible();
});

test("실행하면 진행 카드에 전체 %와 작업별 진행이 보이고, 끝나면 결과 화면으로 넘어간다", async ({
  page
}) => {
  await openComparePair(page, {
    compareScripts: [{ progress: PROGRESS_READING_B, result: SEEDED_RESULT }]
  });
  await holdCompare(page);
  await rangeInput(page, "B").fill("1-5");
  await optionsCard(page).getByRole("checkbox", { name: "머리말" }).click();

  await runButton(page).click();

  const card = progressCard(page);
  await expect(card).toBeVisible();
  await expect(optionsCard(page)).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "비교하는 중" })
  ).toBeVisible();
  await expect(card).toContainText("contract-v1.pdf");
  await expect(card).toContainText("contract-v2.pdf");
  await expect(card.getByText("32%", { exact: true })).toBeVisible();
  await expect(card.getByText(/^경과 \d+:\d{2}$/)).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "전체 진행률" })
  ).toHaveAttribute("aria-valuenow", "32");
  await expect(compareStatus(page, "상태: 비교 중 32%")).toBeVisible();

  await expect(stageRows(page)).toHaveCount(6);
  await expect(stageRow(page, "A 문서 읽기")).toContainText(
    "18 / 18쪽 · 글자 위치 추출"
  );
  await expect(stageBar(page, "A 문서 읽기")).toHaveAttribute(
    "aria-valuenow",
    "100"
  );
  await expect(stageRow(page, "B 문서 읽기")).toContainText(
    "12 / 19쪽 · 글자 위치 추출"
  );
  await expect(stageRow(page, "B 문서 읽기")).toContainText("63%");
  await expect(stageBar(page, "B 문서 읽기")).toHaveAttribute(
    "aria-valuenow",
    "63"
  );
  await expect(stageRow(page, "스캔 쪽 글자 읽기")).toContainText(
    "글자층이 없는 쪽만 읽어요"
  );
  await expect(stageBar(page, "스캔 쪽 글자 읽기")).toHaveAttribute(
    "aria-valuenow",
    "0"
  );
  // 뺀 줄은 글자 정리 세부에 보인다.
  await expect(stageRow(page, "글자 정리")).toContainText(
    "공백·줄바꿈 정리 · 머리말 제외"
  );
  for (const label of ["차이 찾기", "쪽 맞추기"]) {
    await expect(stageBar(page, label)).toHaveAttribute("aria-valuenow", "0");
  }

  await releaseCompare(page);

  await expect(resultHeading(page)).toBeVisible();
  // 확인 필요는 차이 개수에 넣지 않는다(ADR 0001 §5).
  await expect(statusBar(page)).toContainText(/차이 6건\s*\|\s*확인 필요 1건/);
  await expect(compareStatus(page, "상태: 완료")).toBeVisible();

  const requests = await readCompareRequests(page);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    before: FILE_V1.path,
    after: FILE_V2.path,
    options: {
      rangeA: "",
      rangeB: "1-5",
      excludeHeader: true,
      excludeFooter: false,
      excludePageNumbers: false,
      ignoreCase: false
    }
  });

  // 옵션으로 돌아가면 고른 옵션이 그대로다.
  await page.getByRole("button", { name: "옵션으로 돌아가기" }).click();
  await expect(page.getByRole("heading", { name: "새 비교" })).toBeVisible();
  await expect(compareStatus(page, "상태: 준비")).toBeVisible();
  await expect(rangeInput(page, "B")).toHaveValue("1-5");
  await expect(
    optionsCard(page).getByRole("checkbox", { name: "머리말" })
  ).toBeChecked();
});

test("진행 중 취소하면 작업을 멈추고 옵션 화면으로 돌아간다", async ({
  page
}) => {
  await openComparePair(page, {
    compareScripts: [{ progress: PROGRESS_READING_B }]
  });
  await holdCompare(page);

  await runButton(page).click();
  await expect(progressCard(page)).toBeVisible();
  await progressCard(page).getByRole("button", { name: "취소" }).click();

  await expect(optionsCard(page)).toBeVisible();
  await expect(progressCard(page)).toBeHidden();
  await expect(compareStatus(page, "상태: 준비")).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  const [request] = await readCompareRequests(page);
  expect(await readCancelledJobs(page)).toEqual([request.jobId]);
});

test("진행 중 병합 모드로 가도 작업은 계속되고 상태바에 비교 % 가 보이며, 돌아오면 진행 카드가 그대로다", async ({
  page
}) => {
  await openComparePair(page, {
    compareScripts: [{ progress: PROGRESS_SCANNING }]
  });
  await holdCompare(page);

  await runButton(page).click();
  await expect(
    progressCard(page).getByText("49%", { exact: true })
  ).toBeVisible();

  await modeTab(page, "병합").click();

  await expect(progressCard(page)).toBeHidden();
  await expect(compareStatus(page, "비교 중 49%")).toBeVisible();

  await modeTab(page, "비교").click();

  await expect(
    progressCard(page).getByText("49%", { exact: true })
  ).toBeVisible();
  await expect(stageRow(page, "A 문서 읽기")).toContainText(
    "앞서 읽은 결과 재사용"
  );
  await expect(stageRow(page, "B 문서 읽기")).toContainText("19 / 19쪽");
  await expect(stageRow(page, "스캔 쪽 글자 읽기")).toContainText(
    "3 / 10쪽 · 글자층이 없는 쪽만 읽어요"
  );
  await expect(stageBar(page, "스캔 쪽 글자 읽기")).toHaveAttribute(
    "aria-valuenow",
    "30"
  );

  await modeTab(page, "병합").click();
  await releaseCompare(page);
  await expect(compareStatus(page, "비교 중")).toHaveCount(0);

  await modeTab(page, "비교").click();
  await expect(resultHeading(page)).toBeVisible();
  // 시드 결과가 없으면 mock은 차이 없는 결과를 돌려준다.
  await expect(
    page.getByRole("complementary", { name: "차이 목록" })
  ).toContainText("차이가 없어요");
});

test("비교가 실패하면 문제 파일 이름과 코드 문구를 알리고 옵션 화면으로 돌아간다", async ({
  page
}) => {
  const script: E2eCompareScript = {
    progress: PROGRESS_READING_B.slice(0, 1),
    failCode: "PASSWORD_PROTECTED",
    failPath: FILE_V1.path
  };
  await openComparePair(page, { compareScripts: [script] });

  await runButton(page).click();

  const failure = toast(
    page,
    `"${FILE_V1.displayName}" 파일을 비교하지 못했어요.`
  );
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("암호가 걸린 PDF라 열 수 없어요.");
  await expect(failure).not.toContainText("E2E 시드 실패");
  await expect(optionsCard(page)).toBeVisible();
  await expect(runButton(page)).toBeEnabled();
});
