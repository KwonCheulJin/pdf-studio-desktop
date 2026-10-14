import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type { PageBox, PageInfo } from "../src/renderer/shared/api/bindings";

/**
 * 비파괴 회전(계획서 P0-3, 버그 B1·B13).
 * 원본 바이트·mtime 불변은 Rust 테스트가 실제 파일로 확인한다. 여기서는 mock 플랫폼의
 * 호출 기록으로 "프론트가 원본 경로에 쓰기를 요청하지 않는다"와
 * "화면에 보인 최종 회전이 병합 요청에 절대값으로 담긴다"를 확인한다.
 */

const FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");
const VALID_ROTATIONS = [0, 90, 180, 270];
const ROTATE_PATTERN = /rotate\((-?\d+)deg\)/;

const LETTER: PageBox = { left: 0, bottom: 0, right: 612, top: 792 };
const A4: PageBox = { left: 0, bottom: 0, right: 595, top: 842 };
const CROPPED: PageBox = { left: 50, bottom: 50, right: 350, top: 450 };
const OFFSET_MEDIA: PageBox = { left: 100, bottom: 100, right: 400, top: 500 };

interface PageInfoParams {
  mediaBox: PageBox;
  cropBox?: PageBox;
  rotation?: number;
}

function pageInfo({
  mediaBox,
  cropBox = mediaBox,
  rotation = 0
}: PageInfoParams): PageInfo {
  const width = cropBox.right - cropBox.left;
  const height = cropBox.top - cropBox.bottom;
  const isSideways = rotation % 180 !== 0;
  return {
    widthPt: isSideways ? height : width,
    heightPt: isSideways ? width : height,
    rotation,
    mediaBox,
    cropBox
  };
}

interface SeedFileParams {
  fixtureName: string;
  pages: PageInfo[];
}

/** 원본 경로는 사용자가 연 파일 자리. 쓰기 대상과 겹치면 안 된다. */
function seedFile({ fixtureName, pages }: SeedFileParams): E2eMockFile {
  return {
    path: `/Users/e2e/originals/${fixtureName}`,
    displayName: fixtureName,
    pages,
    bytesBase64: readFileSync(
      path.join(FIXTURE_DIRECTORY, fixtureName)
    ).toString("base64")
  };
}

// crates/pdf-core/tests/fixtures 의 같은 이름 파일 사본. 쪽별 정보도 그 생성 스크립트와 같다.
const PLAIN_FILE = seedFile({
  fixtureName: "three-pages.pdf",
  pages: [A4, A4, A4].map((mediaBox) => pageInfo({ mediaBox }))
});

const ROTATED_FILE = seedFile({
  fixtureName: "mixed-geometry.pdf",
  pages: [
    pageInfo({ mediaBox: LETTER }),
    pageInfo({ mediaBox: LETTER, rotation: 90 }),
    pageInfo({ mediaBox: A4, rotation: 270 }),
    pageInfo({ mediaBox: LETTER, cropBox: CROPPED }),
    pageInfo({ mediaBox: OFFSET_MEDIA })
  ]
});

const SEED_FILES = [PLAIN_FILE, ROTATED_FILE];

interface PageRef {
  fileName: string;
  pageNumber: number;
}

interface VisiblePage extends PageRef {
  rotation: number;
}

function thumbnailName({ fileName, pageNumber }: PageRef): string {
  return `${fileName} 페이지 ${pageNumber}`;
}

function pageCard(page: Page, ref: PageRef): Locator {
  return page.getByTestId("page-card").filter({
    has: page.getByRole("img", { name: thumbnailName(ref), exact: true })
  });
}

interface CardActionParams {
  card: Locator;
  action: string;
  times?: number;
}

/** 카드 버튼은 마우스를 올렸을 때만 눌린다. */
async function clickCardAction({
  card,
  action,
  times = 1
}: CardActionParams): Promise<void> {
  for (let count = 0; count < times; count++) {
    await card.hover();
    await card.getByRole("button", { name: action, exact: true }).click();
  }
}

/** 썸네일에 CSS로 적용된 회전(화면에 보이는 각도) */
async function readVisibleRotation(card: Locator): Promise<number> {
  const style = await card.getByRole("img").getAttribute("style");
  const match = ROTATE_PATTERN.exec(style ?? "");
  if (!match) {
    throw new Error(`썸네일에 회전 스타일이 없습니다: ${style}`);
  }
  return Number(match[1]);
}

/** 삭제된 페이지 카드(제자리에 흐리게 남고 복원 버튼이 있다) */
function restoreButton(page: Page): Locator {
  return page.getByRole("button", { name: "페이지 복원", exact: true });
}

/** 삭제 안 된 페이지 카드를 보이는 순서(= 병합 순서)대로 읽는다. */
async function readVisiblePages(page: Page): Promise<VisiblePage[]> {
  const cards = await page
    .getByTestId("page-card")
    .filter({ hasNot: restoreButton(page) })
    .all();
  const visiblePages: VisiblePage[] = [];
  for (const card of cards) {
    const name = await card.getByRole("img").getAttribute("alt");
    const match = /^(.+) 페이지 (\d+)$/.exec(name ?? "");
    if (!match) {
      throw new Error(`썸네일 이름을 읽을 수 없습니다: ${name}`);
    }
    visiblePages.push({
      fileName: match[1],
      pageNumber: Number(match[2]),
      rotation: await readVisibleRotation(card)
    });
  }
  return visiblePages;
}

async function readWrites(page: Page): Promise<E2eWriteCall[]> {
  return page.evaluate(() => window.__E2E_MOCK_WRITES__ ?? []);
}

/**
 * 호출이 실제로 쓰거나 지우는 경로. 임시 출력 경로는 플랫폼이 고르므로 없다. 키·번역 기록은 사용자 파일이
 * 아니라 키체인·앱 데이터 폴더에 쓴다.
 */
function writeTarget(call: E2eWriteCall): string | null {
  switch (call.method) {
    case "mergePdfs":
      return call.request.output.kind === "userPath"
        ? call.request.output.path
        : null;
    case "copyFile":
      return call.destination;
    case "discardTemp":
      return call.path;
    case "exportComparePdf":
    case "exportAnnotatedPdf":
      return `${call.request.output.directory}/${call.request.output.fileName}`;
    case "cancelJob":
    case "saveApiKey":
    case "deleteApiKey":
    case "editTranslatedParagraph":
    case "deleteTranslationRecords":
      return null;
  }
}

test("회전·삭제·병합·저장 후에도 원본에 쓰기를 요청하지 않고 회전은 절대값으로 보낸다", async ({
  page
}) => {
  await page.addInitScript((files) => {
    window.__E2E_MOCK_SEED__ = { files };
  }, SEED_FILES);
  await page.goto("/");

  // 파일 2개 추가 → 둘 다 펼쳐서 페이지 카드로
  await page.getByRole("button", { name: "PDF 병합", exact: true }).click();
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  const documentCards = page.getByTestId("document-card");
  await expect(documentCards).toHaveCount(SEED_FILES.length);
  while ((await documentCards.count()) > 0) {
    await clickCardAction({ card: documentCards.first(), action: "펼치기" });
  }

  const plain = (pageNumber: number): PageRef => ({
    fileName: PLAIN_FILE.displayName,
    pageNumber
  });
  const rotated = (pageNumber: number): PageRef => ({
    fileName: ROTATED_FILE.displayName,
    pageNumber
  });

  // 썸네일이 모두 그려질 때까지
  for (const pageNumber of [1, 2, 3]) {
    await expect(pageCard(page, plain(pageNumber))).toBeVisible();
  }
  for (const pageNumber of [1, 2, 3, 4, 5]) {
    await expect(pageCard(page, rotated(pageNumber))).toBeVisible();
  }

  // 원본 /Rotate가 처음 보이는 각도다.
  expect(await readVisibleRotation(pageCard(page, rotated(2)))).toBe(90);
  expect(await readVisibleRotation(pageCard(page, rotated(3)))).toBe(270);

  // 회전: 원본 90 → 시계 3번(360을 넘겨 0), 원본 270 → 반시계 1번,
  // 원본 0 → 반시계 1번, 원본 0 → 시계 5번(450 → 90)
  await clickCardAction({
    card: pageCard(page, rotated(2)),
    action: "시계 방향 회전",
    times: 3
  });
  await clickCardAction({
    card: pageCard(page, rotated(3)),
    action: "반시계 방향 회전"
  });
  await clickCardAction({
    card: pageCard(page, plain(1)),
    action: "반시계 방향 회전"
  });
  await clickCardAction({
    card: pageCard(page, plain(2)),
    action: "시계 방향 회전",
    times: 5
  });

  // 삭제: 카드는 제자리에 "삭제됨"으로 남는다(복원은 page-restore.spec.ts).
  const deletedPages = [plain(3), rotated(5)];
  for (const ref of deletedPages) {
    await clickCardAction({ card: pageCard(page, ref), action: "페이지 삭제" });
    await expect(pageCard(page, ref).getByText("삭제됨")).toBeVisible();
  }

  const visiblePages = await readVisiblePages(page);
  expect(visiblePages).toEqual([
    { ...plain(1), rotation: 270 },
    { ...plain(2), rotation: 90 },
    { ...rotated(1), rotation: 0 },
    { ...rotated(2), rotation: 0 },
    { ...rotated(3), rotation: 180 },
    { ...rotated(4), rotation: 0 }
  ]);

  // 병합 → 미리보기 → 저장 다이얼로그로 저장 → 작업 공간으로 돌아옴
  await page.getByRole("button", { name: "병합", exact: true }).click();
  await page.getByRole("button", { name: "다운로드" }).click();
  await expect(
    page.getByRole("button", { name: "병합", exact: true })
  ).toBeVisible();

  const writes = await readWrites(page);

  // (a) 쓰기 대상이 연 원본 경로와 하나도 겹치지 않는다.
  const originalPaths = SEED_FILES.map((file) => file.path);
  const writeTargets = writes.flatMap((call) => writeTarget(call) ?? []);
  for (const target of writeTargets) {
    expect(originalPaths).not.toContain(target);
  }
  // 빈 기록으로 통과하지 않도록 흐름이 끝까지 갔는지 확인한다.
  expect(writes.map((call) => call.method)).toEqual([
    "mergePdfs",
    "copyFile",
    "discardTemp"
  ]);

  const mergeCall = writes.find((call) => call.method === "mergePdfs");
  if (mergeCall?.method !== "mergePdfs") {
    throw new Error("병합 요청이 기록되지 않았습니다.");
  }
  const displayNameByPath = new Map(
    SEED_FILES.map((file) => [file.path, file.displayName])
  );
  const requestedPages: VisiblePage[] = mergeCall.request.sources.flatMap(
    (source) =>
      source.pages.map((mergePage) => ({
        fileName: displayNameByPath.get(source.path) ?? source.path,
        pageNumber: mergePage.index + 1,
        rotation: mergePage.rotation
      }))
  );

  // (b) 요청의 회전은 화면에 보인 최종 각도(절대값)와 같고 0/90/180/270 중 하나다.
  expect(requestedPages).toEqual(visiblePages);
  for (const { rotation } of requestedPages) {
    expect(VALID_ROTATIONS).toContain(rotation);
  }

  // (c) 삭제한 페이지는 요청에 없다.
  const requestedRefs: PageRef[] = requestedPages.map(
    ({ fileName, pageNumber }) => ({ fileName, pageNumber })
  );
  for (const deleted of deletedPages) {
    expect(requestedRefs).not.toContainEqual(deleted);
  }
});
