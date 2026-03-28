import { describe, it, expect } from "vitest";
import { isTiffFile, getFileBaseName } from "../file-utils";

describe("isTiffFile", () => {
  it(".tiff 확장자를 TIFF로 인식", () => {
    expect(isTiffFile("/path/to/image.tiff")).toBe(true);
  });

  it(".tif 확장자를 TIFF로 인식", () => {
    expect(isTiffFile("/path/to/image.tif")).toBe(true);
  });

  it("대문자 확장자도 TIFF로 인식", () => {
    expect(isTiffFile("/path/to/image.TIFF")).toBe(true);
    expect(isTiffFile("/path/to/image.TIF")).toBe(true);
  });

  it(".pdf 파일은 TIFF로 인식하지 않음", () => {
    expect(isTiffFile("/path/to/file.pdf")).toBe(false);
  });

  it("확장자 없는 파일은 TIFF로 인식하지 않음", () => {
    expect(isTiffFile("/path/to/file")).toBe(false);
  });

  it("파일명에 tiff가 포함되어도 확장자가 아니면 TIFF로 인식하지 않음", () => {
    expect(isTiffFile("/path/to/tiff-image.pdf")).toBe(false);
  });
});

describe("getFileBaseName", () => {
  it("Unix 경로에서 파일명(확장자 제외) 반환", () => {
    expect(getFileBaseName("/path/to/document.pdf")).toBe("document");
  });

  it("Windows 경로에서 파일명(확장자 제외) 반환", () => {
    expect(getFileBaseName("C:\\Users\\test\\document.pdf")).toBe("document");
  });

  it("파일명만 있을 때 확장자 제외하여 반환", () => {
    expect(getFileBaseName("image.tiff")).toBe("image");
  });

  it("확장자 없는 파일명 그대로 반환", () => {
    expect(getFileBaseName("/path/to/Makefile")).toBe("Makefile");
  });

  it("파일명에 점이 여러 개 있으면 마지막 점 기준으로 분리", () => {
    expect(getFileBaseName("/path/to/archive.tar.gz")).toBe("archive.tar");
  });

  it("점으로 시작하는 파일명은 그대로 반환", () => {
    expect(getFileBaseName("/path/.gitignore")).toBe(".gitignore");
  });
});
