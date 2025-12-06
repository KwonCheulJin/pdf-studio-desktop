import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadDroppedFiles } from "../load-dropped-files";

// ipcClient 모킹
vi.mock("@/renderer/shared/lib/ipc-client", () => ({
  ipcClient: {
    file: {
      getPath: vi.fn()
    },
    meta: {
      getPdfInfo: vi.fn()
    }
  }
}));

// createPdfDocument 모킹
vi.mock("@/renderer/shared/model/pdf-document", () => ({
  createPdfDocument: vi.fn((path, pageCount, title) => ({
    id: `doc-${path}`,
    path,
    name: path.split("/").pop(),
    pageCount,
    title,
    pages: [],
    isExpanded: false
  }))
}));

import { ipcClient } from "@/renderer/shared/lib/ipc-client";
import { createPdfDocument } from "@/renderer/shared/model/pdf-document";

describe("loadDroppedFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("빈 배열 입력 시 빈 배열 반환", async () => {
    const result = await loadDroppedFiles([]);
    expect(result).toEqual([]);
  });

  it("파일 경로를 가져올 수 없는 경우 해당 파일 제외", async () => {
    const mockFile = { name: "test.pdf" } as File;
    vi.mocked(ipcClient.file.getPath).mockReturnValue(null);

    const result = await loadDroppedFiles([mockFile]);

    expect(result).toEqual([]);
    expect(ipcClient.meta.getPdfInfo).not.toHaveBeenCalled();
  });

  it("PDF 정보를 성공적으로 가져온 경우 문서 생성", async () => {
    const mockFile = { name: "test.pdf" } as File;
    vi.mocked(ipcClient.file.getPath).mockReturnValue("/path/to/test.pdf");
    vi.mocked(ipcClient.meta.getPdfInfo).mockResolvedValue({
      pageCount: 5,
      title: "Test PDF"
    });

    const result = await loadDroppedFiles([mockFile]);

    expect(result).toHaveLength(1);
    expect(createPdfDocument).toHaveBeenCalledWith(
      "/path/to/test.pdf",
      5,
      "Test PDF"
    );
  });

  it("PDF 정보 가져오기 실패 시 기본값(pageCount: 1)으로 생성", async () => {
    const mockFile = { name: "test.pdf" } as File;
    vi.mocked(ipcClient.file.getPath).mockReturnValue("/path/to/test.pdf");
    vi.mocked(ipcClient.meta.getPdfInfo).mockRejectedValue(new Error("Failed"));

    const result = await loadDroppedFiles([mockFile]);

    expect(result).toHaveLength(1);
    expect(createPdfDocument).toHaveBeenCalledWith("/path/to/test.pdf", 1);
  });

  it("여러 파일 처리 - 일부 실패 시 성공한 것만 반환", async () => {
    const mockFile1 = { name: "file1.pdf" } as File;
    const mockFile2 = { name: "file2.pdf" } as File;
    const mockFile3 = { name: "file3.pdf" } as File;

    vi.mocked(ipcClient.file.getPath)
      .mockReturnValueOnce("/path/to/file1.pdf")
      .mockReturnValueOnce(null) // file2는 경로 없음
      .mockReturnValueOnce("/path/to/file3.pdf");

    vi.mocked(ipcClient.meta.getPdfInfo)
      .mockResolvedValueOnce({ pageCount: 3, title: "File 1" })
      .mockResolvedValueOnce({ pageCount: 7, title: "File 3" });

    const result = await loadDroppedFiles([mockFile1, mockFile2, mockFile3]);

    expect(result).toHaveLength(2);
    expect(createPdfDocument).toHaveBeenCalledTimes(2);
  });

  it("병렬로 처리됨 (Promise.all)", async () => {
    const mockFile1 = { name: "file1.pdf" } as File;
    const mockFile2 = { name: "file2.pdf" } as File;

    vi.mocked(ipcClient.file.getPath)
      .mockReturnValueOnce("/path/to/file1.pdf")
      .mockReturnValueOnce("/path/to/file2.pdf");

    const resolveOrder: string[] = [];
    vi.mocked(ipcClient.meta.getPdfInfo)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolveOrder.push("file1");
              resolve({ pageCount: 1, title: "" });
            }, 50)
          )
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolveOrder.push("file2");
              resolve({ pageCount: 2, title: "" });
            }, 10)
          )
      );

    await loadDroppedFiles([mockFile1, mockFile2]);

    // 병렬 처리로 인해 file2가 먼저 완료
    expect(resolveOrder).toEqual(["file2", "file1"]);
  });
});
