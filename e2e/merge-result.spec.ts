import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type {
  E2eMockFile,
  E2eMockSeed,
  E2eWriteCall
} from "../src/renderer/app/providers/e2e-platform";
import type { PageInfo } from "../src/renderer/shared/api/bindings";
import type {
  MockMergeOutput,
  PickSavePathOptions
} from "../src/renderer/shared/platform";

/**
 * 전체 병합 버튼과 병합 결과 저장(계획서 P0-6 B5·B9).
 * - B9: 툴바 "병합"은 선택과 무관하게 모든 파일을 병합하고, 툴팁도 그렇게 말한다.
 * - B5: 저장 다이얼로그의 기본 파일 이름은 플랫폼이 준 `MergeResult.fileName`이다.
 *   프론트는 경로 문자열을 `/`·`\`로 나누지 않으므로 Windows 경로에서도 이름이 맞다.
 */

const FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");
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
    bytesBase64: readFileSync(
      path.join(FIXTURE_DIRECTORY, "three-pages.pdf")
    ).toString("base64")
  };
}

const FILE_A = seedFile("alpha.pdf");
const FILE_B = seedFile("bravo.pdf");

/** Windows에서 병합 결과가 놓인 경로와 Rust가 `file_name()`으로 준 이름 */
const WINDOWS_MERGE_OUTPUT: MockMergeOutput = {
  outputPath: "C:\\Users\\x\\문서\\계약.pdf",
  fileName: "계약.pdf"
};

async function openWorkspace(page: Page, seed: E2eMockSeed): Promise<void> {
  await page.addInitScript((initialSeed) => {
    window.__E2E_MOCK_SEED__ = initialSeed;
  }, seed);
  await page.goto("/");
  await page.getByRole("button", { name: "파일 선택" }).click();
  await expect(page.getByTestId("document-card")).toHaveCount(
    seed.files.length
  );
}

async function readWrites(page: Page): Promise<E2eWriteCall[]> {
  return page.evaluate(() => window.__E2E_MOCK_WRITES__ ?? []);
}

async function readSaveDialogs(page: Page): Promise<PickSavePathOptions[]> {
  return page.evaluate(() => window.__E2E_MOCK_SAVE_DIALOGS__ ?? []);
}

test("툴바 '병합' 툴팁은 모든 파일을 병합한다고 말하고, 한 파일만 골라도 모든 파일을 병합한다(B9)", async ({
  page
}) => {
  await openWorkspace(page, { files: [FILE_A, FILE_B] });
  await page
    .getByRole("checkbox", { name: `${FILE_A.displayName} 선택`, exact: true })
    .check();
  const mergeButton = page.getByRole("button", { name: "병합", exact: true });

  await mergeButton.hover();

  await expect(page.getByRole("tooltip")).toHaveText(
    "모든 파일을 하나의 PDF로 병합"
  );
  await mergeButton.click();
  await expect(page.getByRole("button", { name: "다운로드" })).toBeVisible();
  const mergeCall = (await readWrites(page)).find(
    (call) => call.method === "mergePdfs"
  );
  expect(
    mergeCall?.method === "mergePdfs"
      ? mergeCall.request.sources.map((source) => source.path)
      : []
  ).toEqual([FILE_A.path, FILE_B.path]);
});

test("Windows 경로의 병합 결과를 저장하면 저장 다이얼로그 기본 이름은 그 파일 이름이다(B5)", async ({
  page
}) => {
  await openWorkspace(page, {
    files: [FILE_A, FILE_B],
    mergeOutput: WINDOWS_MERGE_OUTPUT
  });
  await page.getByRole("button", { name: "병합", exact: true }).click();
  const downloadButton = page.getByRole("button", { name: "다운로드" });
  await expect(downloadButton).toBeVisible();
  await expect(
    page.getByText(WINDOWS_MERGE_OUTPUT.fileName, { exact: true })
  ).toBeVisible();

  await downloadButton.click();

  await expect
    .poll(() => readWrites(page))
    .toContainEqual({
      method: "copyFile",
      source: WINDOWS_MERGE_OUTPUT.outputPath,
      destination: `/mock/saved/${WINDOWS_MERGE_OUTPUT.fileName}`
    });
  expect(await readSaveDialogs(page)).toEqual([
    { fileName: WINDOWS_MERGE_OUTPUT.fileName }
  ]);
});
