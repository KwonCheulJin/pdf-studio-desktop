import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 디자인 토큰 v2(docs/06-design-system.md, 진행 가이드 Step 7 완료 기준).
 * - 본문 글꼴은 번들한 IBM Plex Sans KR이고 실제로 내려받아 쓴다.
 * - 라이트·다크 모두 본문 글자와 그 배경의 대비가 WCAG AA(4.5:1) 이상이다.
 * - 키보드 포커스가 간 버튼에 링이 그려지고, 링 색이 배경과 3:1 이상 차이 난다.
 * 색은 브라우저가 계산한 값(oklch 포함)을 캔버스에 칠해 sRGB로 읽어 비교한다.
 */

const BODY_FONT_FAMILY = "IBM Plex Sans KR";
const MIN_TEXT_CONTRAST = 4.5;
const MIN_NON_TEXT_CONTRAST = 3;
const MAX_TAB_PRESSES = 10;
/** WebKit(Safari)은 Tab만으로는 버튼에 포커스를 주지 않는다. Option+Tab이 모든 컨트롤을 돈다. */
const FOCUS_NEXT_KEY = "Alt+Tab";
const COLOR_SCHEMES = ["light", "dark"] as const;

type ColorScheme = (typeof COLOR_SCHEMES)[number];

interface ContrastSample {
  text: string;
  foreground: string;
  background: string;
  ratio: number;
}

async function openEmptyScreen(
  page: Page,
  colorScheme: ColorScheme
): Promise<void> {
  await page.emulateMedia({ colorScheme });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "PDF 병합", exact: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark"))
    )
    .toBe(colorScheme === "dark");
}

const FOREGROUND_SOURCE = {
  /** 글자색(`color`) */
  TEXT: "text",
  /** Tailwind 링 색(`--tw-ring-color`) */
  RING: "ring"
} as const;

type ForegroundSource =
  (typeof FOREGROUND_SOURCE)[keyof typeof FOREGROUND_SOURCE];

/**
 * 요소의 글자색(또는 링 색)과, 조상을 따라 올라가 처음 만나는 불투명 배경색의 대비를 잰다.
 * 색 문자열은 캔버스에 칠해 sRGB 바이트로 읽는다(브라우저가 oklch를 그대로 돌려줘도 된다).
 * 링은 요소 바깥에 그려지므로 배경은 부모부터 찾는다.
 */
async function measureContrast(
  locator: Locator,
  foregroundSource: ForegroundSource
): Promise<ContrastSample> {
  return locator.evaluate(
    (element, { source, ringSource }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("2d 캔버스를 만들 수 없다");

      const toRgba = (color: string): number[] => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const channelLuminance = (channel: number): number => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      };
      const luminance = ([red, green, blue]: number[]): number =>
        0.2126 * channelLuminance(red) +
        0.7152 * channelLuminance(green) +
        0.0722 * channelLuminance(blue);

      const isRing = source === ringSource;
      const foreground = isRing
        ? getComputedStyle(element).getPropertyValue("--tw-ring-color").trim()
        : getComputedStyle(element).color;
      if (!foreground) throw new Error("전경색이 없다");

      const OPAQUE_ALPHA = 255;
      let backgroundElement: Element | null = isRing
        ? element.parentElement
        : element;
      let background = "";
      while (backgroundElement) {
        const color = getComputedStyle(backgroundElement).backgroundColor;
        if (toRgba(color)[3] === OPAQUE_ALPHA) {
          background = color;
          break;
        }
        backgroundElement = backgroundElement.parentElement;
      }
      if (!background) throw new Error("불투명 배경을 찾지 못했다");

      const foregroundLuminance = luminance(toRgba(foreground));
      const backgroundLuminance = luminance(toRgba(background));
      return {
        text: (element.textContent ?? "").trim(),
        foreground,
        background,
        ratio:
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      };
    },
    { source: foregroundSource, ringSource: FOREGROUND_SOURCE.RING }
  );
}

async function boxShadowOf(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).boxShadow);
}

test("본문 글꼴은 번들한 IBM Plex Sans KR이고 실제로 로드된다", async ({
  page
}) => {
  await openEmptyScreen(page, "light");

  const bodyFontFamily = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily
  );
  const [firstFamily] = bodyFontFamily.split(",");
  expect([BODY_FONT_FAMILY, `"${BODY_FONT_FAMILY}"`]).toContain(
    firstFamily.trim()
  );

  // 화면의 한글·영문 글자에 쓰인 글꼴 파일을 실제로 내려받았다.
  // (`fonts.check`만으로는 이 글꼴을 등록하지 않았을 때도 true가 나오므로 FontFace 상태를 함께 본다.)
  await expect
    .poll(() =>
      page.evaluate(async (family) => {
        await document.fonts.ready;
        const loadedFaces = [...document.fonts].filter(
          (face) =>
            [family, `"${family}"`].includes(face.family) &&
            face.status === "loaded"
        );
        return (
          loadedFaces.length > 0 &&
          document.fonts.check(`16px "${family}"`, "파일 선택 PDF")
        );
      }, BODY_FONT_FAMILY)
    )
    .toBe(true);
});

for (const colorScheme of COLOR_SCHEMES) {
  test(`${colorScheme}: 본문 글자 대비가 ${MIN_TEXT_CONTRAST}:1 이상이다`, async ({
    page
  }) => {
    await openEmptyScreen(page, colorScheme);

    const samples = [
      await measureContrast(page.locator("body"), FOREGROUND_SOURCE.TEXT),
      await measureContrast(
        page.getByRole("heading", { name: "어떤 작업을 할까요?" }),
        FOREGROUND_SOURCE.TEXT
      ),
      await measureContrast(
        page.getByText("카드를 누르거나 파일을 카드 위에 끌어다 놓으면"),
        FOREGROUND_SOURCE.TEXT
      ),
      await measureContrast(
        page.getByText("PDF, TIFF · 여러 개"),
        FOREGROUND_SOURCE.TEXT
      ),
      await measureContrast(
        page.getByText("시작하기").first(),
        FOREGROUND_SOURCE.TEXT
      )
    ];

    for (const sample of samples) {
      expect(
        sample.ratio,
        `"${sample.text.slice(0, 20)}" ${sample.foreground} / ${sample.background}`
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  test(`${colorScheme}: 키보드 포커스가 간 버튼에 링이 보인다`, async ({
    page
  }) => {
    await openEmptyScreen(page, colorScheme);
    const button = page.getByRole("button", { name: "PDF 병합", exact: true });
    const unfocusedShadow = await boxShadowOf(button);

    for (let press = 0; press < MAX_TAB_PRESSES; press += 1) {
      if (
        await button.evaluate((element) => element === document.activeElement)
      )
        break;
      await page.keyboard.press(FOCUS_NEXT_KEY);
    }
    await expect(button).toBeFocused();
    expect(
      await button.evaluate((element) => element.matches(":focus-visible"))
    ).toBe(true);

    const focusedShadow = await boxShadowOf(button);
    expect(focusedShadow).not.toBe("none");
    expect(focusedShadow).not.toBe(unfocusedShadow);
    const ring = await measureContrast(button, FOREGROUND_SOURCE.RING);
    expect(
      ring.ratio,
      `링 ${ring.foreground} / ${ring.background}`
    ).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
  });
}
