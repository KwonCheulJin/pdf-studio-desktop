import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type {
  MergeRequest,
  PageInfo
} from "../src/renderer/shared/api/bindings";
import type { NativeFileDropEvent } from "../src/renderer/shared/platform";

/**
 * 창 밖에서 끌어온 파일 추가(계획서 P0-6 B2·B8).
 * - B2: 첫 화면(홈)의 병합 카드에 TIFF를 놓으면 `openFiles`가 PDF로 바꾼 결과(`pdfPath`)로 병합한다.
 *   mock도 Rust처럼 병합 소스는 PDF만 받으므로 TIFF 경로를 보내면 병합이 실패한다.
 * - B8: 놓은 파일의 원본 회전(`/Rotate`)이 스토어(썸네일 회전)와 병합 요청에 들어간다.
 */

const FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");
const FIXTURE_BYTES = readFileSync(
  path.join(FIXTURE_DIRECTORY, "three-pages.pdf")
).toString("base64");
const ROTATE_PATTERN = /rotate\((-?\d+)deg\)/;

interface PageInfoParams {
  rotation: number;
}

/** A4 세로 페이지. 원본 회전이 옆으로면 보이는 너비·높이가 바뀐다. */
function a4Page({ rotation }: PageInfoParams): PageInfo {
  const isSideways = rotation % 180 !== 0;
  return {
    widthPt: isSideways ? 842 : 595,
    heightPt: isSideways ? 595 : 842,
    rotation,
    mediaBox: { left: 0, bottom: 0, right: 595, top: 842 },
    cropBox: { left: 0, bottom: 0, right: 595, top: 842 }
  };
}

const PLAIN_FILE: E2eMockFile = {
  path: "/Users/e2e/originals/plain.pdf",
  displayName: "plain.pdf",
  pages: [0, 0, 0].map((rotation) => a4Page({ rotation })),
  bytesBase64: FIXTURE_BYTES
};

/** Rust는 TIFF를 앱 캐시 폴더의 고유 이름 PDF로 바꾸고, 화면 이름은 원본 이름의 확장자만 바꾼다. */
const TIFF_FILE: E2eMockFile = {
  path: "/Users/e2e/scans/scan.tif",
  displayName: "scan.pdf",
  convertedPath: "/mock/converted/0f9c2d6e-scan.pdf",
  pages: [0, 0, 0].map((rotation) => a4Page({ rotation })),
  bytesBase64: FIXTURE_BYTES
};

const ROTATED_ORIGINAL_ROTATIONS = [90, 0, 270];

const ROTATED_FILE: E2eMockFile = {
  path: "/Users/e2e/originals/rotated.pdf",
  displayName: "rotated.pdf",
  pages: ROTATED_ORIGINAL_ROTATIONS.map((rotation) => a4Page({ rotation })),
  bytesBase64: FIXTURE_BYTES
};

/** 놓는 좌표는 이 화면 크기 기준 CSS 픽셀로 잡는다. */
const VIEWPORT = { width: 1280, height: 800 };

test.use({ viewport: VIEWPORT });

async function openEmptyWorkspace(
  page: Page,
  files: E2eMockFile[]
): Promise<void> {
  await page.addInitScript((seedFiles) => {
    window.__E2E_MOCK_SEED__ = { files: seedFiles };
  }, files);
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

interface DropAtParams {
  paths: string[];
  /** CSS 픽셀 좌표 */
  x: number;
  y: number;
}

/** 창 밖에서 끌어와 (x, y)에 놓는다. 좌표는 물리 픽셀로 바꿔 보낸다. */
async function dropAt(
  page: Page,
  { paths, x, y }: DropAtParams
): Promise<void> {
  const pixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const position = { x: x * pixelRatio, y: y * pixelRatio };
  await dropFiles(page, { type: "enter", paths, position });
  await dropFiles(page, { type: "drop", paths, position });
}

interface Point {
  x: number;
  y: number;
}

/** 홈의 "PDF 병합" 카드 가운데(CSS 픽셀) */
async function mergeCardCenter(page: Page): Promise<Point> {
  const box = await page
    .getByRole("region", { name: "PDF 병합", exact: true })
    .boundingBox();
  if (!box) {
    throw new Error("병합 카드가 화면에 없습니다.");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function documentCard(page: Page, file: E2eMockFile): Locator {
  return page.getByRole("button", {
    name: `${file.displayName} 문서`,
    exact: true
  });
}

async function readMergeRequests(page: Page): Promise<MergeRequest[]> {
  const writes: E2eWriteCall[] = await page.evaluate(
    () => window.__E2E_MOCK_WRITES__ ?? []
  );
  return writes.flatMap((call) =>
    call.method === "mergePdfs" ? [call.request] : []
  );
}

/** 문서 카드 썸네일에 CSS로 적용된 회전(첫 페이지의 스토어 회전) */
async function readThumbnailRotation(card: Locator): Promise<number> {
  const thumbnail = card.getByRole("img");
  await expect(thumbnail).toHaveAttribute("style", ROTATE_PATTERN);
  const match = ROTATE_PATTERN.exec(
    (await thumbnail.getAttribute("style")) ?? ""
  );
  return Number(match?.[1]);
}

test("홈 병합 카드에 TIFF를 놓으면 변환된 PDF로 추가되고 그 PDF로 병합된다(B2)", async ({
  page
}) => {
  await openEmptyWorkspace(page, [TIFF_FILE]);

  await dropAt(page, {
    paths: [TIFF_FILE.path],
    ...(await mergeCardCenter(page))
  });

  await expect(documentCard(page, TIFF_FILE)).toBeVisible();
  await page.getByRole("button", { name: "병합", exact: true }).click();

  await expect(page.getByRole("button", { name: "다운로드" })).toBeVisible();
  await expect(
    page.getByRole("alertdialog", { name: "병합하지 못했습니다" })
  ).toHaveCount(0);
  const [request] = await readMergeRequests(page);
  expect(request.sources.map((source) => source.path)).toEqual([
    TIFF_FILE.convertedPath
  ]);
  expect(request.sources[0].pages.map((mergePage) => mergePage.index)).toEqual([
    0, 1, 2
  ]);
});

test("놓은 파일의 원본 회전은 홈 카드·그리드 어디에 놓아도 스토어와 병합 요청에 들어간다(B8)", async ({
  page
}) => {
  await openEmptyWorkspace(page, [ROTATED_FILE, PLAIN_FILE]);

  // 홈 병합 카드에 놓기(빈 병합 화면에 놓기는 app-mode.spec.ts)
  await dropAt(page, {
    paths: [ROTATED_FILE.path],
    ...(await mergeCardCenter(page))
  });
  const rotatedCard = documentCard(page, ROTATED_FILE);
  await expect(rotatedCard).toBeVisible();
  expect(await readThumbnailRotation(rotatedCard)).toBe(
    ROTATED_ORIGINAL_ROTATIONS[0]
  );

  // 그리드가 있는 화면에 놓기(useFileDropZone). 그리드 아래 빈 곳이라 맨 끝에 들어간다.
  await dropAt(page, {
    paths: [PLAIN_FILE.path],
    x: VIEWPORT.width / 2,
    y: VIEWPORT.height - 120
  });
  await expect(documentCard(page, PLAIN_FILE)).toBeVisible();

  await page.getByRole("button", { name: "병합", exact: true }).click();
  await expect(page.getByRole("button", { name: "다운로드" })).toBeVisible();
  const [request] = await readMergeRequests(page);
  expect(
    request.sources.map((source) => ({
      path: source.path,
      rotations: source.pages.map((mergePage) => mergePage.rotation)
    }))
  ).toEqual([
    { path: ROTATED_FILE.path, rotations: ROTATED_ORIGINAL_ROTATIONS },
    { path: PLAIN_FILE.path, rotations: [0, 0, 0] }
  ]);
});
