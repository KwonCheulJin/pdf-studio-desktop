/**
 * 파일 경로가 TIFF 형식인지 확인
 */
export function isTiffFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".tif") || lower.endsWith(".tiff");
}

/**
 * 파일 경로에서 확장자를 제외한 파일명 반환
 * 예: "/path/to/file.tiff" → "file"
 */
export function getFileBaseName(filePath: string): string {
  const fileName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}
