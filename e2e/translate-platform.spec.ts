import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed,
  E2eTranslateScript,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type {
  ApiKeyStatus,
  PageInfo,
  TranslateOptions,
  TranslateProgress,
  TranslateRequest,
  TranslationResult
} from "../src/renderer/shared/api/bindings";

/**
 * 번역 플랫폼 경계(Step 41, 화면은 Step 43~47). 앱이 주입한 플랫폼(`getPlatform()`, 진행 중인 작업 세기로
 * 감싼 것)을 개발 서버 모듈로 불러 번역·키 호출이 Rust 커맨드와 같은 의미로 오가는지 본다.
 * - 번역: 진행률을 `onProgress`로 보내고, 붙잡힌 동안 `cancelJob`이면 `CANCELLED`, 아니면 시드 결과
 * - 고르지 않은 파일은 계획·번역 모두 경로 없는 `PATH_NOT_ALLOWED`
 * - 키: 형식 검사가 네트워크(시드 확인 결과)보다 먼저, 저장하면 상태에는 끝 4자리만, 외부 전송 확인을 다시 받는다
 */

/** 개발 서버가 내주는 앱 모듈(앱과 같은 모듈 인스턴스) */
const CURRENT_PLATFORM_MODULE =
  "/src/renderer/shared/platform/current-platform.ts";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "three-pages.pdf");
const FIXTURE_PAGE_COUNT = 3;
const DOCUMENT_PATH = "/Users/e2e/originals/contract.pdf";
const API_KEY = "sk-ant-api03-e2e-platform-key-a1F3";
const REGISTERED_KEY: ApiKeyStatus = { registered: true, hint: "a1F3" };
const TRANSFER_CONFIRMED_ONCE_SETTING = "translate.transferConfirmedOnce";

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

const DOCUMENT: E2eMockFile = {
  path: DOCUMENT_PATH,
  displayName: "contract.pdf",
  pages: Array.from({ length: FIXTURE_PAGE_COUNT }, () => A4_PAGE),
  bytesBase64: readFileSync(FIXTURE_PATH).toString("base64")
};

const OPTIONS: TranslateOptions = {
  sourceLanguage: "auto",
  range: "1",
  includeScanPages: false,
  model: "sonnet",
  glossary: [{ source: "甲方", target: "갑" }]
};

/** ADR 0002 §9 공식으로 손으로 셈한 값: 범위 1쪽, 묶음 2개 중 1개 끝(가중치 10 + 50% × 80 = 50) */
const PROGRESS: TranslateProgress[] = [
  {
    jobId: "translate-1",
    stage: "readDocument",
    done: 0,
    total: 1,
    stagePercent: 0,
    overallPercent: 0,
    paragraphsDone: 0,
    paragraphCount: 0,
    usage: { inputTokens: 0, outputTokens: 0 }
  },
  {
    jobId: "translate-1",
    stage: "translate",
    done: 1,
    total: 2,
    stagePercent: 50,
    overallPercent: 50,
    paragraphsDone: 4,
    paragraphCount: 9,
    usage: { inputTokens: 1200, outputTokens: 800 }
  }
];

/** 계약 JSON 모양의 결과: 문서 전체 쪽, 범위 밖은 `outOfRange` */
const RESULT: TranslationResult = {
  recordId: "0f3c5d1e2a4b6c8d0f3c5d1e2a4b6c8d",
  path: DOCUMENT_PATH,
  language: "zhHans",
  model: "sonnet",
  pages: [
    {
      page: 0,
      kind: "textLayer",
      paragraphs: [
        {
          key: "0-1-9f86d081884c7d65",
          number: 1,
          source: "甲方应当交付设备。",
          target: "갑은 설비를 인도해야 한다.",
          heading: false,
          status: "translated",
          failCode: null
        }
      ],
      failCode: null
    },
    { page: 1, kind: "outOfRange", paragraphs: [], failCode: null },
    { page: 2, kind: "outOfRange", paragraphs: [], failCode: null }
  ],
  usage: { inputTokens: 1200, outputTokens: 800 },
  elapsedMs: 1500,
  glossaryUsed: [{ source: "甲方", target: "갑" }]
};

function request(jobId: string): TranslateRequest {
  return { jobId, path: DOCUMENT_PATH, options: OPTIONS, resume: true };
}

async function openApp(page: Page, seed: E2eMockSeed): Promise<void> {
  await page.addInitScript((initialSeed) => {
    window.__E2E_MOCK_SEED__ = initialSeed;
  }, seed);
  await page.goto("/");
}

test("번역은 진행률을 보내고, 붙잡힌 동안 취소하면 CANCELLED, 다시 부르면 시드 결과를 돌려준다", async ({
  page
}) => {
  const scripts: E2eTranslateScript[] = [
    { progress: PROGRESS },
    { progress: [], result: RESULT }
  ];
  await openApp(page, {
    files: [DOCUMENT],
    apiKey: REGISTERED_KEY,
    translateScripts: scripts
  });

  const outcome = await page.evaluate(
    async ({ platformModule, cancelled, retried }) => {
      const {
        getPlatform
      }: typeof import("../src/renderer/shared/platform/current-platform") =
        await import(platformModule);
      const platform = getPlatform();
      await platform.pickFiles();
      window.__E2E_HOLD_TRANSLATE__ = new Promise<void>((resolve) => {
        window.__E2E_RELEASE_TRANSLATE__ = resolve;
      });
      const heldProgress: TranslateProgress[] = [];
      const held = platform.translatePdf({
        request: cancelled,
        onProgress: (progress) => heldProgress.push(progress)
      });
      await platform.cancelJob(cancelled.jobId);
      const cancelCode = await held.then(
        () => null,
        (error: { code: string }) => error.code
      );
      window.__E2E_HOLD_TRANSLATE__ = undefined;
      const result = await platform.translatePdf({ request: retried });
      return {
        heldProgress,
        cancelCode,
        result,
        requests: window.__E2E_MOCK_TRANSLATES__ ?? []
      };
    },
    {
      platformModule: CURRENT_PLATFORM_MODULE,
      cancelled: request("translate-1"),
      retried: request("translate-2")
    }
  );

  expect(outcome.heldProgress).toEqual(PROGRESS);
  expect(outcome.cancelCode).toBe("CANCELLED");
  expect(outcome.result).toEqual(RESULT);
  expect(outcome.requests).toEqual([
    request("translate-1"),
    request("translate-2")
  ]);
});

test("고르지 않은 파일은 계획·번역 모두 경로 없는 PATH_NOT_ALLOWED로 거부한다", async ({
  page
}) => {
  await openApp(page, { files: [DOCUMENT], apiKey: REGISTERED_KEY });

  const rejected = await page.evaluate(
    async ({ platformModule, options, notPicked }) => {
      const {
        getPlatform
      }: typeof import("../src/renderer/shared/platform/current-platform") =
        await import(platformModule);
      const platform = getPlatform();
      const errorOf = (work: Promise<unknown>) =>
        work.then(
          () => null,
          (error: { code: string; path: string | null }) => ({
            code: error.code,
            path: error.path
          })
        );
      return [
        await errorOf(
          platform.prepareTranslation({ path: notPicked.path, options })
        ),
        await errorOf(platform.translatePdf({ request: notPicked }))
      ];
    },
    {
      platformModule: CURRENT_PLATFORM_MODULE,
      options: OPTIONS,
      notPicked: request("translate-1")
    }
  );

  expect(rejected).toEqual([
    { code: "PATH_NOT_ALLOWED", path: null },
    { code: "PATH_NOT_ALLOWED", path: null }
  ]);
});

test("키는 형식을 먼저 보고, 저장하면 상태에 끝 4자리만 남고 외부 전송 확인을 다시 받는다", async ({
  page
}) => {
  await openApp(page, { files: [], apiKeyChecks: ["NETWORK_UNAVAILABLE"] });

  const outcome = await page.evaluate(
    async ({ platformModule, apiKey, transferSetting }) => {
      const {
        getPlatform
      }: typeof import("../src/renderer/shared/platform/current-platform") =
        await import(platformModule);
      const platform = getPlatform();
      const codeOf = (work: Promise<unknown>) =>
        work.then(
          () => null,
          (error: { code: string }) => error.code
        );
      const before = await platform.getApiKeyStatus();
      const checks = [
        await codeOf(platform.verifyApiKey("sk-proj-not-an-anthropic-key")),
        await codeOf(platform.verifyApiKey(apiKey)),
        await codeOf(platform.verifyApiKey(apiKey))
      ];
      await platform.setSetting({ key: transferSetting, value: true });
      const saved = await platform.saveApiKey(`  ${apiKey}\n`);
      return {
        before,
        checks,
        saved,
        after: await platform.getApiKeyStatus(),
        transferConfirmedOnce: await platform.getSetting(transferSetting),
        writes: window.__E2E_MOCK_WRITES__ ?? []
      };
    },
    {
      platformModule: CURRENT_PLATFORM_MODULE,
      apiKey: API_KEY,
      transferSetting: TRANSFER_CONFIRMED_ONCE_SETTING
    }
  );

  const savedCall: E2eWriteCall = {
    method: "saveApiKey",
    key: `  ${API_KEY}\n`
  };
  expect(outcome.before).toEqual({ registered: false, hint: null });
  expect(outcome.checks).toEqual([
    "API_KEY_INVALID",
    "NETWORK_UNAVAILABLE",
    null
  ]);
  expect(outcome.saved).toEqual(REGISTERED_KEY);
  expect(outcome.after).toEqual(REGISTERED_KEY);
  expect(outcome.transferConfirmedOnce).toBe(false);
  expect(outcome.writes).toEqual([savedCall]);
});
