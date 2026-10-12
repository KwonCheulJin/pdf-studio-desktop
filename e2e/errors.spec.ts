import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMergeScript,
  E2eMockFailures,
  E2eMockFile,
  E2eMockSeed,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type {
  MergeProgress,
  MergeRequest,
  PageInfo
} from "../src/renderer/shared/api/bindings";

/**
 * 오류 표시(계획서 P0-6 B12, 시안 8)와 병합 진행·취소(시안 7).
 * - 짧은 실패(파일 읽기·다운로드·선택 병합)는 토스트, 문구는 오류 코드로 찾는다.
 * - 전체 병합 실패는 진행 오버레이 자리에 원인·멈춘 단계·코드와 다시 시도 / 이 파일 빼기 / 닫기.
 * - 진행 중에는 전체 %·단계별 %와 취소. 취소는 오류가 아니라 작업 공간으로 조용히 돌아간다.
 * 실패와 진행률은 E2E 시드(`failures`, `mergeScripts`)로 심는다. 시드 오류의 message는
 * "E2E 시드 실패: …"라서 화면에 그대로 새어 나오면 보인다.
 */

const FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");
const FIXTURE_NAME = "three-pages.pdf";
const FIXTURE_PAGE_COUNT = 3;
const SEED_MESSAGE_PREFIX = "E2E 시드 실패";

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

function seedFile(displayName: string): E2eMockFile {
  return {
    path: `/Users/e2e/originals/${displayName}`,
    displayName,
    pages: Array.from({ length: FIXTURE_PAGE_COUNT }, () => A4_PAGE),
    bytesBase64: readFileSync(
      path.join(FIXTURE_DIRECTORY, FIXTURE_NAME)
    ).toString("base64")
  };
}

const FILE_A = seedFile("alpha.pdf");
const FILE_B = seedFile("bravo.pdf");
const BROKEN_FILE = seedFile("broken.pdf");
/** 파일 읽기 실패 토스트는 확장자를 뺀 이름을 보인다(`getFileBaseName`) */
const BROKEN_BASE_NAME = "broken";

/** Rust 진행률 계산(가중치 20/70/10, 정수 내림)으로 손으로 셈한 값. 소스 2개·6쪽 */
const READ_START: MergeProgress = {
  stage: "readFiles",
  done: 0,
  total: 2,
  stagePercent: 0,
  overallPercent: 0
};
const READ_FIRST_DONE: MergeProgress = {
  stage: "readFiles",
  done: 1,
  total: 2,
  stagePercent: 50,
  overallPercent: 10
};
const READ_ALL_DONE: MergeProgress = {
  stage: "readFiles",
  done: 2,
  total: 2,
  stagePercent: 100,
  overallPercent: 20
};
const MERGE_HALF_DONE: MergeProgress = {
  stage: "mergePages",
  done: 3,
  total: 6,
  stagePercent: 50,
  overallPercent: 55
};
const MERGE_ALL_DONE: MergeProgress = {
  stage: "mergePages",
  done: 6,
  total: 6,
  stagePercent: 100,
  overallPercent: 90
};
const SAVE_START: MergeProgress = {
  stage: "save",
  done: 0,
  total: 1,
  stagePercent: 0,
  overallPercent: 90
};

interface OpenWorkspaceParams {
  files: E2eMockFile[];
  failures?: E2eMockFailures;
  mergeScripts?: E2eMergeScript[];
}

async function openWorkspace(
  page: Page,
  { files, failures, mergeScripts }: OpenWorkspaceParams
): Promise<void> {
  const seed: E2eMockSeed = { files, failures, mergeScripts };
  await page.addInitScript((initialSeed) => {
    window.__E2E_MOCK_SEED__ = initialSeed;
  }, seed);
  await page.goto("/");
  await page.getByRole("button", { name: "파일 선택" }).click();
}

async function holdMerge(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__E2E_HOLD_MERGE__ = new Promise<void>((resolve) => {
      window.__E2E_RELEASE_MERGE__ = resolve;
    });
  });
}

async function readWrites(page: Page): Promise<E2eWriteCall[]> {
  return page.evaluate(() => window.__E2E_MOCK_WRITES__ ?? []);
}

async function readMergeRequests(page: Page): Promise<MergeRequest[]> {
  return (await readWrites(page)).flatMap((call) =>
    call.method === "mergePdfs" ? [call.request] : []
  );
}

function documentCards(page: Page): Locator {
  return page.getByTestId("document-card");
}

function statusBar(page: Page): Locator {
  return page.locator("footer");
}

function mergeButton(page: Page): Locator {
  return page.getByRole("button", { name: "병합", exact: true });
}

function failureDialog(page: Page): Locator {
  return page.getByRole("alertdialog", { name: "병합하지 못했습니다" });
}

function progressOverlay(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: "PDF 병합 중" });
}

/** 실패 대화상자 안의 항목 값(멈춘 단계·문제 파일·오류 코드) */
function failureDetail(dialog: Locator, term: string): Locator {
  return dialog
    .locator("div", { has: dialog.page().getByText(term) })
    .locator("dd");
}

test("읽지 못한 파일은 넣지 않고 파일 이름과 코드 문구를 토스트로 보인다", async ({
  page
}) => {
  await openWorkspace(page, {
    files: [FILE_A, BROKEN_FILE],
    failures: { openFiles: { [BROKEN_FILE.path]: "INVALID_PDF" } }
  });

  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: `"${BROKEN_BASE_NAME}" 파일을 열 수 없습니다.` });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(
    "PDF 파일이 손상되었거나 형식이 올바르지 않습니다."
  );
  await expect(toast).not.toContainText(SEED_MESSAGE_PREFIX);

  // 정상 파일만 들어오고 깨진 파일은 1쪽 문서로도 들어오지 않는다(B16)
  await expect(documentCards(page)).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "alpha.pdf 문서", exact: true })
  ).toBeVisible();
  await expect(statusBar(page)).toContainText("전체 파일: 1");
});

test("병합이 실패하면 오버레이 자리에 원인·멈춘 단계·코드를 보이고 다시 시도하면 같은 소스로 다시 병합한다", async ({
  page
}) => {
  await openWorkspace(page, {
    files: [FILE_A, FILE_B],
    mergeScripts: [
      {
        progress: [
          READ_START,
          READ_FIRST_DONE,
          READ_ALL_DONE,
          MERGE_ALL_DONE,
          SAVE_START
        ],
        failCode: "WRITE_FAILED"
      }
    ]
  });
  await expect(documentCards(page)).toHaveCount(2);

  await mergeButton(page).click();

  const dialog = failureDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "파일을 저장하지 못했습니다. 저장 공간과 권한을 확인해 주세요."
  );
  await expect(dialog).not.toContainText(SEED_MESSAGE_PREFIX);
  await expect(failureDetail(dialog, "멈춘 단계")).toHaveText("저장");
  await expect(failureDetail(dialog, "오류 코드")).toHaveText("WRITE_FAILED");
  // 저장 실패는 소스 파일을 가리키지 않는다
  await expect(
    dialog.getByRole("button", { name: "이 파일 빼기" })
  ).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "다시 시도" })).toBeFocused();
  await expect(statusBar(page)).toContainText("상태: 오류");

  await dialog.getByRole("button", { name: "다시 시도" }).click();

  await expect(page.getByRole("button", { name: "다운로드" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const [failed, retried] = await readMergeRequests(page);
  expect(retried.sources).toEqual(failed.sources);
  expect(retried.sources.map((source) => source.path)).toEqual([
    FILE_A.path,
    FILE_B.path
  ]);
  expect(retried.jobId).not.toBe(failed.jobId);
});

test("파일 읽기 중 실패하면 그 파일을 보이고 '이 파일 빼기'로 작업 공간에서 뺀다", async ({
  page
}) => {
  await openWorkspace(page, {
    files: [FILE_A, FILE_B],
    mergeScripts: [
      // 첫 소스(alpha)를 끝내고 둘째 소스(bravo)를 열다 실패. Rust는 그 파일을 `AppError.path`에 담는다.
      {
        progress: [READ_START, READ_FIRST_DONE],
        failCode: "INVALID_PDF",
        failPath: FILE_B.path
      }
    ]
  });
  await expect(documentCards(page)).toHaveCount(2);

  await mergeButton(page).click();

  const dialog = failureDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "PDF 파일이 손상되었거나 형식이 올바르지 않습니다."
  );
  await expect(failureDetail(dialog, "멈춘 단계")).toHaveText("파일 읽기");
  await expect(failureDetail(dialog, "문제 파일")).toHaveText("bravo.pdf");
  await expect(failureDetail(dialog, "오류 코드")).toHaveText("INVALID_PDF");

  await dialog.getByRole("button", { name: "이 파일 빼기" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(documentCards(page)).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "alpha.pdf 문서", exact: true })
  ).toBeVisible();
  await expect(statusBar(page)).toContainText("상태: 준비");
});

test("모르는 코드로 진행 전에 실패하면 일반 문구·'시작 전'을 보이고, 떠 있는 동안 Delete는 카드를 지우지 않으며, 닫으면 작업 공간 상태로 돌아간다", async ({
  page
}) => {
  await openWorkspace(page, {
    files: [FILE_A, FILE_B],
    mergeScripts: [{ progress: [], failCode: "SOMETHING_NEW" }]
  });
  await expect(documentCards(page)).toHaveCount(2);
  await page
    .getByRole("checkbox", { name: `${FILE_A.displayName} 선택`, exact: true })
    .check();

  await mergeButton(page).click();

  const dialog = failureDialog(page);
  await expect(dialog).toContainText(
    "알 수 없는 오류가 발생했습니다. 다시 시도해 주세요."
  );
  await expect(failureDetail(dialog, "멈춘 단계")).toHaveText("시작 전");
  await expect(failureDetail(dialog, "오류 코드")).toHaveText("SOMETHING_NEW");
  await expect(statusBar(page)).toContainText("상태: 오류");
  // 대화상자에 포커스가 있는 동안 선택 단축키(Delete)는 꺼져 있다
  await page.keyboard.press("Delete");

  await dialog.getByRole("button", { name: "닫기" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(statusBar(page)).toContainText("상태: 준비");
  await expect(documentCards(page)).toHaveCount(2);
  await expect(mergeButton(page)).toBeEnabled();
});

test("병합 결과 저장(copyFile)이 실패하면 토스트로 보이고 미리보기에 남는다", async ({
  page
}) => {
  await openWorkspace(page, {
    files: [FILE_A, FILE_B],
    failures: { copyFile: "WRITE_FAILED" }
  });
  await expect(documentCards(page)).toHaveCount(2);
  await mergeButton(page).click();
  const downloadButton = page.getByRole("button", { name: "다운로드" });
  await expect(downloadButton).toBeVisible();

  await downloadButton.click();

  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "병합 결과를 저장하지 못했습니다." });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(
    "파일을 저장하지 못했습니다. 저장 공간과 권한을 확인해 주세요."
  );
  await expect(toast).not.toContainText(SEED_MESSAGE_PREFIX);
  await expect(downloadButton).toBeVisible();
  const methods = (await readWrites(page)).map((call) => call.method);
  expect(methods).toContain("copyFile");
  expect(methods).not.toContain("discardTemp");
});

test("선택 병합이 실패하면 토스트로 보이고 결과 창을 닫는다", async ({
  page
}) => {
  await openWorkspace(page, {
    files: [FILE_A, FILE_B],
    mergeScripts: [{ progress: [], failCode: "PDFIUM_FAILURE" }]
  });
  await expect(documentCards(page)).toHaveCount(2);
  for (const file of [FILE_A, FILE_B]) {
    await page
      .getByRole("checkbox", { name: `${file.displayName} 선택`, exact: true })
      .check();
  }

  await page.getByRole("button", { name: "선택 파일 병합" }).click();

  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "선택한 항목을 병합하지 못했습니다." });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("PDF를 처리하는 중 문제가 생겼습니다.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await readMergeRequests(page)).toHaveLength(1);
});

test("진행 중에는 전체 %·단계별 %를 보이고 취소하면 cancelJob 뒤 오류 없이 작업 공간으로 돌아간다", async ({
  page
}) => {
  await openWorkspace(page, {
    files: [FILE_A, FILE_B],
    mergeScripts: [
      {
        progress: [READ_START, READ_FIRST_DONE, READ_ALL_DONE, MERGE_HALF_DONE]
      }
    ]
  });
  await expect(documentCards(page)).toHaveCount(2);
  await holdMerge(page);

  await mergeButton(page).click();

  const overlay = progressOverlay(page);
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute("aria-live", "polite");
  const percentOf = (name: string) =>
    overlay.getByRole("progressbar", { name, exact: true });
  await expect(percentOf("전체 진행률")).toHaveAttribute("aria-valuenow", "55");
  await expect(percentOf("파일 읽기 진행률")).toHaveAttribute(
    "aria-valuenow",
    "100"
  );
  await expect(percentOf("페이지 합치기 진행률")).toHaveAttribute(
    "aria-valuenow",
    "50"
  );
  await expect(percentOf("저장 진행률")).toHaveAttribute("aria-valuenow", "0");
  await expect(overlay).toContainText("55%");

  await overlay.getByRole("button", { name: "취소" }).click();

  await expect(overlay).toHaveCount(0);
  await expect(statusBar(page)).toContainText("상태: 준비");
  await expect(failureDialog(page)).toHaveCount(0);
  await expect(documentCards(page)).toHaveCount(2);
  await expect(mergeButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "다운로드" })).toHaveCount(0);

  const writes = await readWrites(page);
  const [request] = await readMergeRequests(page);
  expect(writes.map((call) => call.method)).toEqual(["mergePdfs", "cancelJob"]);
  expect(writes[1]).toEqual({ method: "cancelJob", jobId: request.jobId });
});
