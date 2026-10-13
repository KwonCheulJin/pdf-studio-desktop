import { readFileSync } from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type ConsoleMessage,
  type Locator,
  type Page
} from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed,
  E2eUpdateCall
} from "../src/renderer/app/providers/e2e-platform";
import type { PageInfo } from "../src/renderer/shared/api/bindings";
import type { MockUpdate } from "../src/renderer/shared/platform";

/**
 * 자동 업데이트(계획서 P4-4).
 * - 시작 후 한 번 확인하고, 새 버전이 있으면 토스트의 '업데이트'로 받기 → 설치·재시작.
 * - 받는 동안 %(정수 내림, 끝나기 전에는 100을 보이지 않는다).
 * - 진행 중인 작업(병합·비교·내보내기·저장·번역·다시 번역)이 있으면 재시작하지 않고 끝난 뒤 '다시 시작'을 누르게 한다.
 * - 확인 실패는 화면에 보이지 않고 로그만, 받기 실패는 알리고 다시 시도할 수 있다.
 * 새 버전·실패는 E2E 시드(`update`, `failures`)로 심고 호출은 `__E2E_MOCK_UPDATES__`로 본다.
 */

const NEW_VERSION = "9.9.9";

/** 개발 서버가 내주는 앱 모듈(앱과 같은 모듈 인스턴스) */
const RUNNING_WORK_MODULE = "/src/renderer/shared/platform/running-work.ts";
const MOCK_PLATFORM_MODULE = "/src/renderer/shared/platform/mock-platform.ts";

/** 진행 중인 작업으로 세는 플랫폼 호출 */
const TRACKED_METHODS = [
  "mergePdfs",
  "comparePdfs",
  "exportComparePdf",
  "exportAnnotatedPdf",
  "copyFile",
  "translatePdf",
  "retranslateParagraph"
] as const;

type TrackedMethod = (typeof TRACKED_METHODS)[number];

interface TrackedCallState {
  method: TrackedMethod;
  /** 호출이 끝나기 전 `hasRunningWork()` */
  isRunningDuring: boolean;
  /** 호출이 실패로 끝난 뒤 `hasRunningWork()` */
  isRunningAfter: boolean;
}

interface TrackedCallArgs {
  methods: readonly TrackedMethod[];
  runningWorkModule: string;
  mockPlatformModule: string;
}

/** 끝나지 않는 가짜 호출을 하나씩 감싸 부르고, 실패로 끝낸 뒤의 상태까지 기록한다. */
async function trackPendingCalls({
  methods,
  runningWorkModule,
  mockPlatformModule
}: TrackedCallArgs): Promise<TrackedCallState[]> {
  const {
    hasRunningWork,
    trackRunningWork
  }: typeof import("../src/renderer/shared/platform/running-work") =
    await import(runningWorkModule);
  const {
    createMockPlatform
  }: typeof import("../src/renderer/shared/platform/mock-platform") =
    await import(mockPlatformModule);
  const states: TrackedCallState[] = [];
  for (const method of methods) {
    let fail: () => void = () => {};
    const pending = new Promise<never>((_, reject) => {
      fail = () => reject(new Error(method));
    });
    const tracked = trackRunningWork({
      ...createMockPlatform(),
      [method]: () => pending
    });
    const call = (tracked[method] as () => Promise<unknown>)();
    const isRunningDuring = hasRunningWork();
    fail();
    await call.catch(() => undefined);
    states.push({ method, isRunningDuring, isRunningAfter: hasRunningWork() });
  }
  return states;
}

const FIXTURE_PATH = path.join(__dirname, "fixtures", "three-pages.pdf");
const FIXTURE_PAGE_COUNT = 3;

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
    bytesBase64: readFileSync(FIXTURE_PATH).toString("base64")
  };
}

/** 2000바이트 중 500 → 999바이트. 999 / 2000 = 49.95% → 정수 내림 49 */
const HALF_RECEIVED_UPDATE: MockUpdate = {
  version: NEW_VERSION,
  totalBytes: 2000,
  chunkBytes: [500, 499]
};

async function openApp(page: Page, seed: E2eMockSeed): Promise<void> {
  await page.addInitScript((initialSeed) => {
    window.__E2E_MOCK_SEED__ = initialSeed;
  }, seed);
  await page.goto("/");
}

async function holdUpdateDownload(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__E2E_HOLD_UPDATE_DOWNLOAD__ = new Promise<void>((resolve) => {
      window.__E2E_RELEASE_UPDATE_DOWNLOAD__ = resolve;
    });
  });
}

async function readUpdateCalls(page: Page): Promise<E2eUpdateCall[]> {
  return page.evaluate(() => window.__E2E_MOCK_UPDATES__ ?? []);
}

function updateToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]");
}

/** 앱 로그(mock은 `console[level]`로 남긴다)에서 경고만 모은다. */
function collectWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "warning") {
      warnings.push(message.text());
    }
  });
  return warnings;
}

test("새 버전이 있으면 알리고, 업데이트를 누르면 받는 %를 내림으로 보인 뒤 설치·재시작한다", async ({
  page
}) => {
  await openApp(page, { files: [], update: HALF_RECEIVED_UPDATE });

  const toast = updateToast(page);
  await expect(toast).toContainText("새 버전이 나왔어요");
  await expect(toast).toContainText(`v${NEW_VERSION}`);
  expect(await readUpdateCalls(page)).toEqual(["checkForUpdate"]);

  await holdUpdateDownload(page);
  await toast.getByRole("button", { name: "업데이트", exact: true }).click();

  await expect(toast).toContainText("업데이트를 받는 중이에요");
  await expect(toast).toContainText("49%");
  expect(await readUpdateCalls(page)).toEqual(["checkForUpdate", "download"]);

  await page.evaluate(() => window.__E2E_RELEASE_UPDATE_DOWNLOAD__?.());

  await expect(toast).toContainText("업데이트를 설치하는 중이에요");
  await expect
    .poll(() => readUpdateCalls(page))
    .toEqual(["checkForUpdate", "download", "installAndRestart"]);
});

test("다 받기 전에는 100%를 보이지 않는다", async ({ page }) => {
  await openApp(page, {
    files: [],
    update: { version: NEW_VERSION, totalBytes: 1000, chunkBytes: [1000] }
  });
  const toast = updateToast(page);
  await holdUpdateDownload(page);
  await toast.getByRole("button", { name: "업데이트", exact: true }).click();

  await expect(toast).toContainText("업데이트를 받는 중이에요");
  await expect(toast).toContainText("99%");
  await expect(toast).not.toContainText("100%");
});

test("병합 중이면 받은 뒤 재시작하지 않고, 병합이 끝난 뒤 '다시 시작'을 누르면 설치한다", async ({
  page
}) => {
  await openApp(page, {
    files: [seedFile("alpha.pdf"), seedFile("bravo.pdf")],
    update: HALF_RECEIVED_UPDATE
  });
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(2);
  await page.evaluate(() => {
    window.__E2E_HOLD_MERGE__ = new Promise<void>((resolve) => {
      window.__E2E_RELEASE_MERGE__ = resolve;
    });
  });
  await page.getByRole("button", { name: "병합", exact: true }).click();
  const mergeProgress = page
    .getByRole("status")
    .filter({ hasText: "병합하는 중" });
  await expect(mergeProgress).toBeVisible();

  const toast = updateToast(page);
  await toast.getByRole("button", { name: "업데이트", exact: true }).click();

  // 받기는 끝났지만 병합이 진행 중이라 설치·재시작을 부르지 않았다.
  await expect(toast).toContainText("작업이 끝나면 다시 시작해 주세요");
  expect(await readUpdateCalls(page)).toEqual(["checkForUpdate", "download"]);

  // 병합 중에 '다시 시작'을 눌러도 막힌다.
  await toast.getByRole("button", { name: "다시 시작", exact: true }).click();
  await expect(toast).toContainText("작업이 끝나면 다시 시작해 주세요");
  expect(await readUpdateCalls(page)).toEqual(["checkForUpdate", "download"]);

  await page.evaluate(() => window.__E2E_RELEASE_MERGE__?.());
  await expect(mergeProgress).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다운로드" })).toBeVisible();

  await toast.getByRole("button", { name: "다시 시작", exact: true }).click();
  await expect(toast).toContainText("업데이트를 설치하는 중이에요");
  await expect
    .poll(() => readUpdateCalls(page))
    .toEqual(["checkForUpdate", "download", "installAndRestart"]);
});

test("확인이 실패하면 알리지 않고 경고 로그만 남긴다", async ({ page }) => {
  const warnings = collectWarnings(page);
  // 새 버전을 함께 심어, 실패가 없었다면 알림이 떴을 상황에서 확인한다.
  await openApp(page, {
    files: [seedFile("alpha.pdf")],
    update: HALF_RECEIVED_UPDATE,
    failures: { checkForUpdate: "IPC_FAILED" }
  });

  await expect
    .poll(() => warnings.some((text) => text.startsWith("업데이트 확인 실패")))
    .toBe(true);
  expect(warnings).toContain(
    "업데이트 확인 실패: [IPC_FAILED] E2E 시드 실패: checkForUpdate"
  );
  // 실패 처리 뒤에 띄운 토스트가 있었다면 다음 화면 갱신까지는 그려진다. 파일을 열어 갱신을 기다린 뒤
  // 한 번만 센다(`toHaveCount(0)`은 저절로 닫히는 토스트가 사라질 때까지 기다려 통과해 버린다).
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(1);
  expect(await updateToast(page).count()).toBe(0);
  expect(await readUpdateCalls(page)).toEqual(["checkForUpdate"]);
});

test("받기가 실패하면 알리고 설치하지 않으며, 다시 시도하면 다시 받는다", async ({
  page
}) => {
  const warnings = collectWarnings(page);
  await openApp(page, {
    files: [],
    update: HALF_RECEIVED_UPDATE,
    failures: { downloadUpdate: "IPC_FAILED" }
  });
  const toast = updateToast(page);
  await toast.getByRole("button", { name: "업데이트", exact: true }).click();

  await expect(toast).toContainText("업데이트를 받지 못했어요");
  await expect(toast).not.toContainText("E2E 시드 실패");
  expect(await readUpdateCalls(page)).toEqual(["checkForUpdate", "download"]);
  await expect
    .poll(() => warnings)
    .toContain("업데이트 받기 실패: [IPC_FAILED] E2E 시드 실패: download");

  await toast.getByRole("button", { name: "다시 시도", exact: true }).click();

  await expect
    .poll(() => readUpdateCalls(page))
    .toEqual(["checkForUpdate", "download", "download"]);
  await expect(toast).toContainText("업데이트를 받지 못했어요");
});

test("병합·비교·내보내기·저장·번역 호출이 끝나기 전에는 진행 중인 작업으로 센다", async ({
  page
}) => {
  await openApp(page, { files: [] });

  const results = await page.evaluate(trackPendingCalls, {
    methods: TRACKED_METHODS,
    runningWorkModule: RUNNING_WORK_MODULE,
    mockPlatformModule: MOCK_PLATFORM_MODULE
  });

  expect(results).toEqual([
    { method: "mergePdfs", isRunningDuring: true, isRunningAfter: false },
    { method: "comparePdfs", isRunningDuring: true, isRunningAfter: false },
    {
      method: "exportComparePdf",
      isRunningDuring: true,
      isRunningAfter: false
    },
    {
      method: "exportAnnotatedPdf",
      isRunningDuring: true,
      isRunningAfter: false
    },
    { method: "copyFile", isRunningDuring: true, isRunningAfter: false },
    { method: "translatePdf", isRunningDuring: true, isRunningAfter: false },
    {
      method: "retranslateParagraph",
      isRunningDuring: true,
      isRunningAfter: false
    }
  ]);
});
