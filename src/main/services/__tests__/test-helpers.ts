import { PDFDocument, rgb } from "pdf-lib";
import fse from "fs-extra";
import path from "node:path";
import os from "node:os";

const TEST_FIXTURES_DIR = path.join(os.tmpdir(), "pdf-studio-test-fixtures");

export async function ensureTestFixturesDir(): Promise<string> {
  await fse.ensureDir(TEST_FIXTURES_DIR);
  return TEST_FIXTURES_DIR;
}

export async function cleanupTestFixtures(): Promise<void> {
  try {
    await fse.remove(TEST_FIXTURES_DIR);
  } catch {
    // Ignore cleanup errors (files may be in use by other tests)
  }
}

export async function createTestPdf(
  pageCount: number,
  filename?: string
): Promise<string> {
  const dir = await ensureTestFixturesDir();
  const pdf = await PDFDocument.create();

  for (let i = 0; i < pageCount; i++) {
    const page = pdf.addPage([595, 842]); // A4 size
    page.drawText(`Page ${i + 1}`, {
      x: 50,
      y: 800,
      size: 24,
      color: rgb(0, 0, 0)
    });
  }

  const pdfBytes = await pdf.save();
  const filePath = path.join(
    dir,
    filename ?? `test-${Date.now()}-${pageCount}pages.pdf`
  );
  await fse.writeFile(filePath, pdfBytes);

  return filePath;
}

export async function createTestPdfWithTitle(
  pageCount: number,
  title: string
): Promise<string> {
  const dir = await ensureTestFixturesDir();
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);

  for (let i = 0; i < pageCount; i++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Page ${i + 1}`, {
      x: 50,
      y: 800,
      size: 24,
      color: rgb(0, 0, 0)
    });
  }

  const pdfBytes = await pdf.save();
  const filePath = path.join(dir, `test-${Date.now()}-titled.pdf`);
  await fse.writeFile(filePath, pdfBytes);

  return filePath;
}

export async function getPageCount(filePath: string): Promise<number> {
  const pdfBytes = await fse.readFile(filePath);
  const pdf = await PDFDocument.load(pdfBytes);
  return pdf.getPageCount();
}

export async function getOutputDir(): Promise<string> {
  const dir = path.join(TEST_FIXTURES_DIR, "output");
  await fse.ensureDir(dir);
  return dir;
}
