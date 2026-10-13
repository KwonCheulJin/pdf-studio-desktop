import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { E2eErrorReport } from "../src/renderer/app/providers/e2e-error-report";
import type { E2eMockSeed } from "../src/renderer/app/providers/e2e-platform";
import type { PageInfo } from "../src/renderer/shared/api/bindings";

/**
 * 테마·오류 보고 설정(계획서 P1-5 B7·S2).
 * - 테마는 시스템 → 라이트 → 다크 순서로 바뀌고, 새로고침(재시작) 뒤에도 남는다.
 *   시스템일 때만 OS 다크 모드(`prefers-color-scheme`) 변경을 따른다.
 * - 오류 보고는 테스트가 `__E2E_ERROR_REPORTS__`를 넣을 때만 켜진다(설정 없는 빌드 흉내는
 *   넣지 않은 경우). 실제로 보내지 않고 보내기 직전(경로를 지운 뒤) 내용을 그 배열에서 읽는다.
 * 설정은 개발 서버에서 `localStorage`에 저장된다(`e2e-platform.ts`).
 * 테마·오류 보고 버튼은 파일이 있을 때 보이는 아래 도구 막대에 있어 파일 하나를 먼저 연다.
 */

const FIXTURE_PATH = path.join(__dirname, "fixtures", "three-pages.pdf");

const NOTICE_TITLE = "오류가 나면 개발자에게 알립니다.";

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

/** 열기에 실패시킬 파일. 경로·이름이 보고에 남으면 안 된다. */
const SENSITIVE_PATH = "/Users/x/문서/계약.pdf";
const SENSITIVE_WORDS = ["계약", "문서", "/Users/x", "C:\\Users"];

/** 파일을 열 수 있는 시드를 넣는다. 새로고침해도 다시 들어간다. */
async function seedWorkspace(page: Page): Promise<void> {
  const seed: E2eMockSeed = {
    files: [
      {
        path: "/Users/e2e/originals/alpha.pdf",
        displayName: "alpha.pdf",
        pages: [A4_PAGE, A4_PAGE, A4_PAGE],
        bytesBase64: readFileSync(FIXTURE_PATH).toString("base64")
      }
    ]
  };
  await page.addInitScript((initialSeed) => {
    window.__E2E_MOCK_SEED__ = initialSeed;
  }, seed);
}

/** 빈 화면에서 파일을 열어 아래 도구 막대를 띄운다. */
async function openFile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(1);
}

function themeButton(page: Page): Locator {
  return page.getByRole("button", { name: /^테마: / });
}

function errorReportingButton(page: Page): Locator {
  return page.getByRole("button", { name: "오류 보고" });
}

async function hasDarkClass(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.classList.contains("dark")
  );
}

/** 오류 보고 기능이 있는 빌드처럼 띄운다. 새로고침해도 다시 켜진다. */
async function enableErrorReporting(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__E2E_ERROR_REPORTS__ = [];
  });
}

async function readReports(page: Page): Promise<E2eErrorReport[]> {
  return page.evaluate(() => window.__E2E_ERROR_REPORTS__ ?? []);
}

test.describe("테마", () => {
  test("시스템일 때 OS 다크 모드 변경을 따른다", async ({ page }) => {
    await seedWorkspace(page);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await openFile(page);

    await expect(themeButton(page)).toHaveAccessibleName("테마: 시스템");
    expect(await hasDarkClass(page)).toBe(false);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => hasDarkClass(page)).toBe(true);

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => hasDarkClass(page)).toBe(false);
  });

  test("라이트·다크를 고르면 OS 설정과 상관없이 그대로이고 새로고침 뒤에도 남는다", async ({
    page
  }) => {
    await seedWorkspace(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect.poll(() => hasDarkClass(page)).toBe(true);
    await openFile(page);

    await themeButton(page).click();
    await expect(themeButton(page)).toHaveAccessibleName("테마: 라이트");
    await expect.poll(() => hasDarkClass(page)).toBe(false);

    await themeButton(page).click();
    await expect(themeButton(page)).toHaveAccessibleName("테마: 다크");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => hasDarkClass(page)).toBe(true);

    await page.reload();
    // 저장된 테마는 첫 화면을 그리기 전에 적용된다.
    expect(await hasDarkClass(page)).toBe(true);
    await openFile(page);
    await expect(themeButton(page)).toHaveAccessibleName("테마: 다크");

    // 고정 테마에서는 OS 변경을 구독하지 않는다.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    expect(await hasDarkClass(page)).toBe(true);

    await themeButton(page).click();
    await expect(themeButton(page)).toHaveAccessibleName("테마: 시스템");
    await expect.poll(() => hasDarkClass(page)).toBe(false);
  });
});

test.describe("오류 보고", () => {
  test("설정이 없는 빌드에서는 버튼·안내가 없고 아무것도 보내지 않는다", async ({
    page
  }) => {
    await seedWorkspace(page);
    await page.goto("/");
    await openFile(page);
    await expect(themeButton(page)).toBeVisible();

    await expect(errorReportingButton(page)).toHaveCount(0);
    await expect(page.getByText(NOTICE_TITLE)).toHaveCount(0);
    expect(await page.evaluate(() => window.__E2E_ERROR_REPORTS__)).toBe(
      undefined
    );
  });

  test("처음 실행할 때 한 번 안내하고, 끈 설정은 새로고침 뒤에도 남아 보내지 않는다", async ({
    page
  }) => {
    await seedWorkspace(page);
    await enableErrorReporting(page);
    await page.goto("/");

    await expect(page.getByText(NOTICE_TITLE)).toBeVisible();
    await openFile(page);
    await expect(errorReportingButton(page)).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await errorReportingButton(page).click();
    await expect(errorReportingButton(page)).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    await page.reload();
    await openFile(page);
    await expect(errorReportingButton(page)).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await expect(page.getByText(NOTICE_TITLE)).toHaveCount(0);

    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("꺼진 동안의 오류");
      });
    });
    // 보고는 비동기라, 켜져 있었다면 쌓였을 만큼 기다린 뒤 비어 있는지 본다.
    await page.waitForTimeout(500);
    expect(await readReports(page)).toEqual([]);
  });

  test("안내의 끄기로도 끌 수 있다", async ({ page }) => {
    await seedWorkspace(page);
    await enableErrorReporting(page);
    await page.goto("/");

    await page.getByRole("button", { name: "끄기" }).click();
    await openFile(page);
    await expect(errorReportingButton(page)).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  test("파일 열기 실패 보고는 경로·파일 이름을 지운다", async ({ page }) => {
    const seed: E2eMockSeed = {
      files: [
        { path: SENSITIVE_PATH, displayName: "계약.pdf", pages: [A4_PAGE] }
      ],
      failures: { openFiles: { [SENSITIVE_PATH]: "INVALID_PDF" } }
    };
    await page.addInitScript((initialSeed) => {
      window.__E2E_MOCK_SEED__ = initialSeed;
    }, seed);
    await enableErrorReporting(page);
    await page.goto("/");

    await page.getByRole("button", { name: "파일 선택", exact: true }).click();

    await expect.poll(async () => (await readReports(page)).length).toBe(1);
    const [report] = await readReports(page);
    expect(report.message).toBe("E2E 시드 실패: *.pdf");
    expect(report.meta).toEqual({
      source: "file-load",
      code: "INVALID_PDF",
      filePath: "*.pdf"
    });
    const serialized = JSON.stringify(report);
    for (const word of SENSITIVE_WORDS) {
      expect(serialized).not.toContain(word);
    }
  });

  test("처리되지 않은 오류도 메시지·스택의 경로를 지우고 앱 자산 URL은 남긴다", async ({
    page
  }) => {
    await enableErrorReporting(page);
    await page.goto("/");
    // 저장된 설정을 읽은 뒤 첫 화면을 그리므로, 화면이 보이면 보고가 켜져 있다.
    await expect(
      page.getByRole("button", { name: "파일 선택", exact: true })
    ).toBeVisible();

    await page.evaluate(() => {
      const error = new Error(
        "읽기 실패: C:\\Users\\x\\문서\\계약 최종.pdf; file:///Users/x/문서/계약.pdf, 계약서.tiff (/Users/x/문서)"
      );
      error.stack =
        "load@/Users/x/문서/계약.pdf:1:2\nrun@tauri://localhost/assets/index-abc.js:10:5";
      void Promise.reject(error);
    });

    await expect.poll(async () => (await readReports(page)).length).toBe(1);
    const [report] = await readReports(page);
    expect(report.message).toBe("읽기 실패: *.pdf; *.pdf, *.tiff (~/…)");
    expect(report.stack).toBe(
      "load@*.pdf:1:2\nrun@tauri://localhost/assets/index-abc.js:10:5"
    );
    expect(report.meta).toEqual({ source: "unhandledrejection" });
    const serialized = JSON.stringify(report);
    for (const word of SENSITIVE_WORDS) {
      expect(serialized).not.toContain(word);
    }
  });
});
