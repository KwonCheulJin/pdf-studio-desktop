import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockSeed,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import {
  MAX_GLOSSARY_TERM_CHARS,
  MAX_GLOSSARY_TERMS,
  type GlossaryTerm,
  type PageInfo
} from "../src/renderer/shared/api/bindings";

/**
 * 설정 모달·API 키 모달(계획서 P6-8, 진행 가이드 Step 43, 시안 14·11).
 * - 홈·번역 머리 톱니와 모든 화면의 ⌘,로 열고 Esc·✕로 닫는다.
 * - 탭: 일반(테마·저장된 번역 지우기)·번역(키·기본 모델·외부 전송 확인·공용 용어집)·오류 보고(기능 있는 빌드만)·정보.
 * - 키 모달: 입력을 멈추거나 붙여 넣으면 형식을 보고 확인을 한 번 부른다(마지막 응답만 쓴다). 확인에 성공한 키만
 *   저장하고, 저장 뒤 화면 어디에도 키 원문이 없다.
 * 설정은 개발 서버에서 `localStorage`에 저장되어 `page.reload()` 뒤에도 남는다(`e2e-platform.ts`).
 * 키 상태는 mock 메모리라 새로고침하면 시드로 돌아간다(키 유지는 Rust 키체인 몫).
 */

const FIXTURE_BYTES = readFileSync(
  path.join(__dirname, "fixtures", "three-pages.pdf")
).toString("base64");

const APP_VERSION: string = JSON.parse(
  readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
).version;

const A4_PAGE: PageInfo = {
  widthPt: 595,
  heightPt: 842,
  rotation: 0,
  mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
  cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
};

/** 형식에 맞는 가짜 키(실제 키가 아니다). 저장 뒤 화면에 남으면 안 된다. */
const FAKE_KEY = "sk-ant-api03-e2eFakeKeyNotReal0000-a1F3";
const FAKE_KEY_HINT = "a1F3";
const OTHER_FAKE_KEY = "sk-ant-api03-e2eOtherFakeKey9999-Zz90";

const TEXT = {
  VERIFIED: "키를 확인했어요. 저장하면 번역을 시작할 수 있어요.",
  CHECKING: "키를 확인하는 중…",
  API_KEY_INVALID: "API 키가 올바르지 않아요. 키를 다시 확인해 주세요.",
  NETWORK_UNAVAILABLE:
    "인터넷에 연결할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요.",
  ERROR_REPORTING_NOT_SENT: "번역 문서 내용과 API 키"
} as const;

const SETTING_STORAGE_PREFIX = "e2e-setting:";
const GLOSSARY_SETTING = "translate.glossary";

interface OpenAppParams {
  seed?: Omit<E2eMockSeed, "files">;
  /** 오류 보고 기능이 있는 빌드처럼 띄운다. */
  hasErrorReporting?: boolean;
  /** 페이지를 열기 전에 저장소에 넣어 둘 설정(재시작 전 상태) */
  storedSettings?: Record<string, unknown>;
}

/** 병합·번역 카드에서 고를 파일 하나와 함께 홈을 연다. 새로고침해도 시드가 다시 들어간다. */
async function openApp(
  page: Page,
  {
    seed = {},
    hasErrorReporting = false,
    storedSettings = {}
  }: OpenAppParams = {}
): Promise<void> {
  const initialSeed: E2eMockSeed = {
    files: [
      {
        path: "/Users/e2e/originals/alpha.pdf",
        displayName: "alpha.pdf",
        pages: [A4_PAGE, A4_PAGE, A4_PAGE],
        bytesBase64: FIXTURE_BYTES
      }
    ],
    ...seed
  };
  await page.addInitScript(
    ({ value, withErrorReporting, settings, prefix }) => {
      window.__E2E_MOCK_SEED__ = value;
      if (withErrorReporting) window.__E2E_ERROR_REPORTS__ = [];
      // 새로고침 때 다시 넣으면 앱이 바꾼 값을 덮으므로 처음 한 번만 넣는다.
      if (sessionStorage.getItem("e2e-stored-settings") === null) {
        for (const [key, stored] of Object.entries(settings)) {
          localStorage.setItem(`${prefix}${key}`, JSON.stringify(stored));
        }
        sessionStorage.setItem("e2e-stored-settings", "done");
      }
    },
    {
      value: initialSeed,
      withErrorReporting: hasErrorReporting,
      settings: storedSettings,
      prefix: SETTING_STORAGE_PREFIX
    }
  );
  await page.goto("/");
}

function settingsDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "설정" });
}

function keyDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Claude API 키 등록" });
}

function settingsTab(page: Page, name: string): Locator {
  return settingsDialog(page)
    .getByRole("tablist", { name: "설정 항목" })
    .getByRole("tab", { name, exact: true });
}

/** 머리 톱니(홈·번역 화면에만 있다) */
function gearButton(page: Page): Locator {
  return page.getByRole("button", { name: "설정", exact: true });
}

async function openSettingsTab(page: Page, name: string): Promise<Locator> {
  await page.keyboard.press("Meta+Comma");
  await expect(settingsDialog(page)).toBeVisible();
  await settingsTab(page, name).click();
  return settingsDialog(page).getByRole("tabpanel");
}

function toast(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

async function readWrites(page: Page): Promise<E2eWriteCall[]> {
  return page.evaluate(() => window.__E2E_MOCK_WRITES__ ?? []);
}

async function readKeyCheckCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__E2E_MOCK_KEY_CHECKS__ ?? 0);
}

/** 형식 검사를 통과한 키 확인을 붙잡는다. 이 뒤에 온 확인은 풀 때까지 응답하지 않는다. */
async function holdKeyChecks(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__E2E_HOLD_VERIFY_API_KEY__ = new Promise<void>((resolve) => {
      window.__E2E_RELEASE_VERIFY_API_KEY__ = resolve;
    });
  });
}

/** 붙잡기를 풀고, 이 뒤에 온 확인은 붙잡지 않는다. */
async function releaseKeyChecks(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__E2E_HOLD_VERIFY_API_KEY__ = undefined;
    window.__E2E_RELEASE_VERIFY_API_KEY__?.();
  });
}

function keyInput(page: Page): Locator {
  return keyDialog(page).getByLabel("API 키", { exact: true });
}

function keyStatus(page: Page): Locator {
  return keyDialog(page).getByRole("status");
}

async function hasDarkClass(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.classList.contains("dark")
  );
}

test.describe("열기·닫기", () => {
  test("홈·번역 머리 톱니와 모든 화면의 ⌘,로 열고 Esc·✕로 닫는다", async ({
    page
  }) => {
    await openApp(page);
    const dialog = settingsDialog(page);

    // 홈 톱니 → 첫 탭(일반)이 열린다. Esc로 닫는다.
    await gearButton(page).click();
    await expect(dialog).toBeVisible();
    await expect(settingsTab(page, "일반")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // ⌘, → ✕로 닫는다.
    await page.keyboard.press("Meta+Comma");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(dialog).toBeHidden();

    // 번역 화면 머리 톱니
    await page.getByRole("button", { name: "번역할 파일 선택" }).click();
    await expect(page.getByRole("heading", { name: "새 번역" })).toBeVisible();
    await gearButton(page).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // 병합 화면에는 톱니가 없고(병합 툴바는 그대로, Q16) ⌘,로 연다.
    const mergeTab = page
      .getByRole("tablist", { name: "작업 모드" })
      .getByRole("tab", { name: "병합", exact: true });
    await mergeTab.click();
    await expect(mergeTab).toHaveAttribute("aria-selected", "true");
    await expect(gearButton(page)).toHaveCount(0);
    await page.keyboard.press("Meta+Comma");
    await expect(dialog).toBeVisible();
  });
});

test.describe("탭", () => {
  test("오류 보고 기능이 없는 빌드는 일반·번역·정보 탭만 있다", async ({
    page
  }) => {
    await openApp(page);
    await page.keyboard.press("Meta+Comma");
    await expect(
      settingsDialog(page).getByRole("tablist").getByRole("tab")
    ).toHaveText(["일반", "번역", "정보"]);
  });

  test("오류 보고 기능이 있는 빌드는 오류 보고 탭에 보내는 것·보내지 않는 것을 보인다", async ({
    page
  }) => {
    await openApp(page, { hasErrorReporting: true });
    await page.keyboard.press("Meta+Comma");
    await expect(
      settingsDialog(page).getByRole("tablist").getByRole("tab")
    ).toHaveText(["일반", "번역", "오류 보고", "정보"]);

    // ↓ 키로 탭을 옮긴다.
    await settingsTab(page, "번역").click();
    await page.keyboard.press("ArrowDown");
    await expect(settingsTab(page, "오류 보고")).toBeFocused();
    const panel = settingsDialog(page).getByRole("tabpanel");
    await expect(panel).toHaveAccessibleName("오류 보고");
    await expect(
      panel.getByRole("checkbox", { name: "오류가 나면 개발자에게 알리기" })
    ).toBeChecked();
    await expect(panel).toContainText(TEXT.ERROR_REPORTING_NOT_SENT);
  });

  test("정보 탭은 앱 버전·저장소 주소를 보이고 오픈소스 라이선스 대화상자를 연다", async ({
    page
  }) => {
    await openApp(page, { seed: { thirdPartyNotices: "# 고지\n\npdfium" } });
    const panel = await openSettingsTab(page, "정보");

    await expect(panel).toContainText(`PDF Studio v${APP_VERSION}`);
    await expect(panel).toContainText(
      "github.com/KwonCheulJin/pdf-studio-desktop"
    );

    await panel.getByRole("button", { name: "오픈소스 라이선스" }).click();
    const notices = page.getByRole("dialog", { name: "오픈소스 라이선스" });
    await expect(notices).toContainText("pdfium");
    // Esc는 위에 뜬 라이선스 대화상자만 닫는다.
    await page.keyboard.press("Escape");
    await expect(notices).toBeHidden();
    await expect(settingsDialog(page)).toBeVisible();
  });

  test("일반 탭의 저장된 번역 모두 지우기는 행 안에서 한 번 더 묻는다", async ({
    page
  }) => {
    page.on("dialog", () => {
      throw new Error("브라우저 확인 창을 쓰지 않는다");
    });
    await openApp(page);
    const panel = await openSettingsTab(page, "일반");

    await panel.getByRole("button", { name: "모두 지우기" }).click();
    await expect(panel).toContainText("저장된 번역을 모두 지울까요?");
    await panel.getByRole("button", { name: "취소" }).click();
    await expect(
      panel.getByRole("button", { name: "모두 지우기" })
    ).toBeVisible();

    await panel.getByRole("button", { name: "모두 지우기" }).click();
    await panel.getByRole("button", { name: "지우기", exact: true }).click();
    await expect(toast(page, "저장된 번역을 모두 지웠어요.")).toBeVisible();
    // 취소한 첫 번째는 지우지 않았다.
    expect(
      (await readWrites(page)).filter(
        (call) => call.method === "deleteTranslationRecords"
      )
    ).toHaveLength(1);
  });

  test("테마·오류 보고는 도구 막대 버튼과 같은 설정이고 새로고침 뒤에도 남는다", async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page, { hasErrorReporting: true });
    const general = await openSettingsTab(page, "일반");
    const themes = general.getByRole("radiogroup", { name: "테마" });
    await expect(themes.getByRole("radio", { checked: true })).toHaveText(
      "시스템"
    );
    await themes.getByRole("radio", { name: "다크" }).click();
    await expect.poll(() => hasDarkClass(page)).toBe(true);

    await settingsTab(page, "오류 보고").click();
    const reporting = settingsDialog(page).getByRole("checkbox", {
      name: "오류가 나면 개발자에게 알리기"
    });
    await reporting.click();
    await expect(reporting).not.toBeChecked();

    await page.reload();
    expect(await hasDarkClass(page)).toBe(true);
    // 병합 작업 공간 아래 도구 막대의 버튼이 같은 값을 보인다.
    await page.getByRole("button", { name: "파일 선택", exact: true }).click();
    await expect(page.getByTestId("document-card")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /^테마: / })
    ).toHaveAccessibleName("테마: 다크");
    await expect(
      page.getByRole("button", { name: "오류 보고" })
    ).toHaveAttribute("aria-pressed", "false");

    // 도구 막대에서 바꾸면 설정에도 보인다.
    await page.getByRole("button", { name: /^테마: / }).click();
    const reopened = await openSettingsTab(page, "일반");
    await expect(
      reopened
        .getByRole("radiogroup", { name: "테마" })
        .getByRole("radio", { checked: true })
    ).toHaveText("시스템");
  });
});

test.describe("API 키", () => {
  test("등록 안 됨 → 등록: 확인 중·성공 뒤 저장하면 끝 4자리만 보이고 화면 어디에도 키 원문이 없다", async ({
    page
  }) => {
    await openApp(page, { seed: { apiKeyChecks: [null] } });
    const panel = await openSettingsTab(page, "번역");
    await expect(panel).toContainText("등록 안 됨");

    await panel.getByRole("button", { name: "등록", exact: true }).click();
    const save = keyDialog(page).getByRole("button", { name: "저장" });
    await expect(save).toBeDisabled();
    await expect(keyInput(page)).toHaveAttribute("type", "password");

    await holdKeyChecks(page);
    await keyInput(page).fill(FAKE_KEY);
    await expect(keyStatus(page)).toHaveText(TEXT.CHECKING);
    await expect(save).toBeDisabled();
    await releaseKeyChecks(page);
    await expect(keyStatus(page)).toHaveText(TEXT.VERIFIED);
    expect(await readKeyCheckCount(page)).toBe(1);

    // 눈 버튼으로 보이고 가린다.
    await keyDialog(page).getByRole("button", { name: "키 보이기" }).click();
    await expect(keyInput(page)).toHaveAttribute("type", "text");
    await keyDialog(page).getByRole("button", { name: "키 가리기" }).click();
    await expect(keyInput(page)).toHaveAttribute("type", "password");

    await save.click();
    await expect(keyDialog(page)).toBeHidden();
    await expect(panel).toContainText("등록됨");
    await expect(panel).toContainText(`sk-ant-····${FAKE_KEY_HINT}`);
    await expect(panel).toContainText("· 키체인에 저장");
    const saves = (await readWrites(page)).filter(
      (call) => call.method === "saveApiKey"
    );
    expect(saves).toEqual([{ method: "saveApiKey", key: FAKE_KEY }]);
    expect(await page.content()).not.toContain(FAKE_KEY);

    // 다시 열면 입력이 비어 있다.
    await panel.getByRole("button", { name: "바꾸기" }).click();
    await expect(keyInput(page)).toHaveValue("");
    expect(await page.content()).not.toContain(FAKE_KEY);
  });

  test("입력을 멈추기 전에는 확인하지 않고 멈추면 한 번, 붙여 넣으면 바로 확인한다", async ({
    page
  }) => {
    await openApp(page);
    const panel = await openSettingsTab(page, "번역");
    await panel.getByRole("button", { name: "등록", exact: true }).click();

    await keyInput(page).pressSequentially(FAKE_KEY);
    expect(await readKeyCheckCount(page)).toBe(0);
    await expect(keyStatus(page)).toHaveText(TEXT.VERIFIED);
    expect(await readKeyCheckCount(page)).toBe(1);

    await keyInput(page).fill("");
    await keyInput(page).dispatchEvent("paste");
    await keyInput(page).fill(OTHER_FAKE_KEY);
    // 붙여 넣기는 기다리지 않고 바로 확인을 부른다.
    expect(await readKeyCheckCount(page)).toBe(2);
    await expect(keyStatus(page)).toHaveText(TEXT.VERIFIED);
  });

  test("형식이 틀리면 확인을 부르지 않고, 확인 실패는 코드 문구를 보이며 저장할 수 없다", async ({
    page
  }) => {
    await openApp(page, {
      seed: { apiKeyChecks: ["NETWORK_UNAVAILABLE", "API_KEY_INVALID"] }
    });
    const panel = await openSettingsTab(page, "번역");
    await panel.getByRole("button", { name: "등록", exact: true }).click();
    const save = keyDialog(page).getByRole("button", { name: "저장" });

    // 접두어가 다르다(`API_KEY_PREFIX`) → 네트워크 없이 형식 오류
    await keyInput(page).fill("sk-other-e2eFakeKey");
    await expect(keyStatus(page)).toHaveText(TEXT.API_KEY_INVALID);
    // 길이 상한(`API_KEY_MAX_LEN` 256)을 넘는다 → 형식 오류
    await keyInput(page).fill(`sk-ant-${"x".repeat(250)}`);
    await expect(keyStatus(page)).toHaveText(TEXT.API_KEY_INVALID);
    expect(await readKeyCheckCount(page)).toBe(0);
    await expect(save).toBeDisabled();

    // 형식은 맞지만 확인이 실패한다(시드 순서대로).
    await keyInput(page).fill(FAKE_KEY);
    await expect(keyStatus(page)).toHaveText(TEXT.NETWORK_UNAVAILABLE);
    await expect(save).toBeDisabled();
    await keyInput(page).fill(OTHER_FAKE_KEY);
    await expect(keyStatus(page)).toHaveText(TEXT.API_KEY_INVALID);
    await expect(save).toBeDisabled();
    expect(await readKeyCheckCount(page)).toBe(2);

    // 취소하면 입력한 키를 버린다.
    await keyDialog(page).getByRole("button", { name: "취소" }).click();
    await expect(keyDialog(page)).toBeHidden();
    expect(await page.content()).not.toContain(OTHER_FAKE_KEY);
    expect(
      (await readWrites(page)).filter((call) => call.method === "saveApiKey")
    ).toEqual([]);
  });

  test("입력을 바꾸면 그 전 확인의 늦은 응답은 버린다", async ({ page }) => {
    // 먼저 부른 확인은 붙잡혀 나중에 응답하고, 그 사이 바뀐 입력의 확인이 먼저 성공한다.
    await openApp(page, {
      seed: { apiKeyChecks: [null, "NETWORK_UNAVAILABLE"] }
    });
    const panel = await openSettingsTab(page, "번역");
    await panel.getByRole("button", { name: "등록", exact: true }).click();

    await holdKeyChecks(page);
    await keyInput(page).fill(FAKE_KEY);
    await expect(keyStatus(page)).toHaveText(TEXT.CHECKING);
    await page.evaluate(() => {
      window.__E2E_HOLD_VERIFY_API_KEY__ = undefined;
    });
    await keyInput(page).fill(OTHER_FAKE_KEY);
    await expect(keyStatus(page)).toHaveText(TEXT.VERIFIED);

    await releaseKeyChecks(page);
    await expect.poll(() => readKeyCheckCount(page)).toBe(2);
    // 늦게 온 실패 응답이 성공을 덮지 않는다. 응답이 처리될 시간을 준 뒤 본다.
    await page.waitForTimeout(300);
    await expect(keyStatus(page)).toHaveText(TEXT.VERIFIED);
    await expect(keyDialog(page)).not.toContainText(TEXT.NETWORK_UNAVAILABLE);

    await keyDialog(page).getByRole("button", { name: "저장" }).click();
    expect(
      (await readWrites(page)).filter((call) => call.method === "saveApiKey")
    ).toEqual([{ method: "saveApiKey", key: OTHER_FAKE_KEY }]);
  });

  test("등록된 키: 바꾸기는 키 모달을 열고, 삭제는 행 안에서 확인한 뒤 지운다", async ({
    page
  }) => {
    page.on("dialog", () => {
      throw new Error("브라우저 확인 창을 쓰지 않는다");
    });
    await openApp(page, {
      seed: { apiKey: { registered: true, hint: FAKE_KEY_HINT } }
    });
    const panel = await openSettingsTab(page, "번역");
    await expect(panel).toContainText("등록됨");
    await expect(panel).toContainText(`sk-ant-····${FAKE_KEY_HINT}`);

    // 바꾸기 → 키 모달, Esc는 키 모달만 닫는다.
    await panel.getByRole("button", { name: "바꾸기" }).click();
    await expect(keyDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(keyDialog(page)).toBeHidden();
    await expect(settingsDialog(page)).toBeVisible();

    await panel.getByRole("button", { name: "삭제" }).click();
    await expect(panel).toContainText("키를 지울까요?");
    await panel.getByRole("button", { name: "취소" }).click();
    await expect(panel).toContainText(`sk-ant-····${FAKE_KEY_HINT}`);

    await panel.getByRole("button", { name: "삭제" }).click();
    await panel.getByRole("button", { name: "지우기" }).click();
    await expect(panel).toContainText("등록 안 됨");
    await expect(
      panel.getByRole("button", { name: "등록", exact: true })
    ).toBeVisible();
    expect(
      (await readWrites(page)).filter((call) => call.method === "deleteApiKey")
    ).toHaveLength(1);
  });
});

test.describe("번역 설정", () => {
  function glossaryEditor(page: Page): Locator {
    return settingsDialog(page).getByRole("tabpanel");
  }

  test("기본 모델·외부 전송 확인·공용 용어집은 바꾸면 바로 저장되고 새로고침 뒤에도 남는다", async ({
    page
  }) => {
    await openApp(page);
    let panel = await openSettingsTab(page, "번역");
    const models = panel.getByRole("radiogroup", { name: "기본 모델" });
    await expect(models.getByRole("radio", { checked: true })).toHaveText(
      "Sonnet 5.5 (권장)"
    );
    await models.getByRole("radio", { name: "Haiku 5.5" }).click();
    const confirm = panel.getByRole("checkbox", {
      name: "번역 전에 외부 전송 확인 받기"
    });
    await expect(confirm).toBeChecked();
    await confirm.click();
    await expect(confirm).not.toBeChecked();

    await expect(panel).toContainText("용어 0개");
    await panel.getByRole("button", { name: "편집" }).click();
    const editor = glossaryEditor(page);
    await expect(
      settingsDialog(page).getByRole("heading", { name: "공용 용어집" })
    ).toBeVisible();
    await editor.getByRole("button", { name: "+ 용어 추가" }).click();
    // 추가한 행의 원어 칸에 바로 쓴다.
    await expect(editor.getByLabel("원어 1", { exact: true })).toBeFocused();
    await page.keyboard.type("额定电压");
    await editor.getByLabel("번역어 1", { exact: true }).fill("정격 전압");
    await editor.getByRole("button", { name: "+ 용어 추가" }).click();
    await editor.getByLabel("원어 2", { exact: true }).fill("保修");
    await editor.getByLabel("번역어 2", { exact: true }).fill("보증");
    // 같은 원어(앞의 것을 쓴다)와 빈 칸이 있는 행은 세지 않는다.
    await editor.getByRole("button", { name: "+ 용어 추가" }).click();
    await editor.getByLabel("원어 3", { exact: true }).fill(" 保修 ");
    await editor.getByLabel("번역어 3", { exact: true }).fill("품질 보증");
    await editor.getByRole("button", { name: "+ 용어 추가" }).click();
    await editor.getByLabel("원어 4", { exact: true }).fill("PS-200");
    await expect(editor).toContainText(
      "빈 칸이 있거나 앞에 같은 원어가 있는 용어"
    );
    await expect(editor.getByLabel("원어 3", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    await expect(editor.getByLabel("원어 2", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "false"
    );

    await settingsDialog(page)
      .getByRole("button", { name: "번역 설정으로 돌아가기" })
      .click();
    await expect(panel).toContainText("용어 2개");

    await page.reload();
    panel = await openSettingsTab(page, "번역");
    await expect(
      panel
        .getByRole("radiogroup", { name: "기본 모델" })
        .getByRole("radio", { checked: true })
    ).toHaveText("Haiku 5.5");
    await expect(
      panel.getByRole("checkbox", { name: "번역 전에 외부 전송 확인 받기" })
    ).not.toBeChecked();
    await expect(panel).toContainText("용어 2개");
    await panel.getByRole("button", { name: "편집" }).click();
    // 적힌 그대로(쓰는 중인 행 포함) 남는다.
    const cells = glossaryEditor(page).getByRole("textbox");
    await expect(cells).toHaveCount(8);
    expect(
      await cells.evaluateAll((inputs) =>
        inputs.map((input) =>
          input instanceof HTMLInputElement ? input.value : null
        )
      )
    ).toEqual([
      "额定电压",
      "정격 전압",
      "保修",
      "보증",
      " 保修 ",
      "품질 보증",
      "PS-200",
      ""
    ]);

    // 행을 지우면 바로 저장된다.
    await glossaryEditor(page)
      .getByRole("button", { name: "용어 지우기" })
      .first()
      .click();
    await page.reload();
    panel = await openSettingsTab(page, "번역");
    await expect(panel).toContainText("용어 1개");
  });

  test("용어 수·글자 수 상한(바인딩 상수)을 넘겨 적을 수 없다", async ({
    page
  }) => {
    const fullGlossary: GlossaryTerm[] = Array.from(
      { length: MAX_GLOSSARY_TERMS },
      (_, index) => ({ source: `원어${index}`, target: `번역어${index}` })
    );
    await openApp(page, {
      storedSettings: { [GLOSSARY_SETTING]: fullGlossary }
    });
    const panel = await openSettingsTab(page, "번역");
    await expect(panel).toContainText(`용어 ${MAX_GLOSSARY_TERMS}개`);
    await panel.getByRole("button", { name: "편집" }).click();
    const editor = glossaryEditor(page);
    const add = editor.getByRole("button", { name: "+ 용어 추가" });
    await expect(add).toBeDisabled();
    await expect(editor.getByLabel("원어 1", { exact: true })).toHaveAttribute(
      "maxlength",
      String(MAX_GLOSSARY_TERM_CHARS)
    );
    await expect(
      editor.getByLabel("번역어 1", { exact: true })
    ).toHaveAttribute("maxlength", String(MAX_GLOSSARY_TERM_CHARS));

    await editor.getByRole("button", { name: "용어 지우기" }).first().click();
    await expect(add).toBeEnabled();
  });
});
