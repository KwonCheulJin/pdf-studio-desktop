import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 홈 반응형 배치.
 * - 큰 창(1920×1080)에서 제목·카드·안내 묶음이 스크롤 영역의 세로 가운데에 오고 카드가 기본 창보다 넓다.
 * - 모든 카드에서 그림 속 요소가 그림 상자 안에 들어간다(기본·큰 창 모두).
 */

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const LARGE_VIEWPORT = { width: 1920, height: 1080 };
const CARD_COUNT = 3;
/** 위·아래 여백 차이 허용 오차(px, 소수 반올림) */
const CENTER_TOLERANCE_PX = 2;
/** 그림 상자 경계 오차(px, 소수 반올림) */
const BOUNDS_TOLERANCE_PX = 0.5;
const VIEWPORTS = [
  { name: "기본 창", size: DEFAULT_VIEWPORT },
  { name: "큰 창", size: LARGE_VIEWPORT }
] as const;

async function openHome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__E2E_MOCK_SEED__ = { files: [] };
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "어떤 작업을 할까요?" })
  ).toBeVisible();
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("요소가 화면에 없어요.");
  return box;
}

async function firstCardWidth(page: Page): Promise<number> {
  return (await boxOf(page.getByRole("button", { name: "PDF 병합", exact: true }))).width;
}

test("큰 창에서 홈 콘텐츠는 세로 가운데에 오고 카드가 기본 창보다 넓다", async ({
  page
}) => {
  await page.setViewportSize(DEFAULT_VIEWPORT);
  await openHome(page);
  const defaultWidth = await firstCardWidth(page);

  await page.setViewportSize(LARGE_VIEWPORT);
  const largeWidth = await firstCardWidth(page);
  expect(largeWidth).toBeGreaterThan(defaultWidth);

  const area = await boxOf(page.getByTestId("home-page"));
  const content = await boxOf(page.getByTestId("home-content"));
  const top = content.y - area.y;
  const bottom = area.y + area.height - (content.y + content.height);
  expect(Math.abs(top - bottom)).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
  expect(top).toBeGreaterThan(0);
});

for (const { name, size } of VIEWPORTS) {
  test(`${name}: 카드 그림 속 요소가 그림 상자 안에 있다`, async ({ page }) => {
    await page.setViewportSize(size);
    await openHome(page);

    const frames = page.getByTestId("home-illustration");
    await expect(frames).toHaveCount(CARD_COUNT);
    for (let index = 0; index < CARD_COUNT; index += 1) {
      const frame = frames.nth(index);
      const frameBox = await boxOf(frame);
      const elements = await frame.locator("*").all();
      for (const element of elements) {
        const box = await element.boundingBox();
        if (box === null) continue;
        expect(box.x).toBeGreaterThanOrEqual(frameBox.x - BOUNDS_TOLERANCE_PX);
        expect(box.y).toBeGreaterThanOrEqual(frameBox.y - BOUNDS_TOLERANCE_PX);
        expect(box.x + box.width).toBeLessThanOrEqual(
          frameBox.x + frameBox.width + BOUNDS_TOLERANCE_PX
        );
        expect(box.y + box.height).toBeLessThanOrEqual(
          frameBox.y + frameBox.height + BOUNDS_TOLERANCE_PX
        );
      }
    }
  });
}
