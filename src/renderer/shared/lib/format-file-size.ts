const BYTES_PER_UNIT = 1024;
const SIZE_UNITS = ["KB", "MB", "GB"] as const;
const BYTE_UNIT = "B";
/** 이보다 작은 값은 소수 한 자리(1.1 MB), 크면 정수(12 MB)로 보인다. */
const ONE_DECIMAL_BELOW = 10;
const ONE_DECIMAL = 1;

/** 파일 크기를 화면용으로 줄인다(1024 단위). 예: 512 B, 1.1 MB, 12 MB */
export function formatFileSize(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) {
    return `${bytes} ${BYTE_UNIT}`;
  }
  let value = bytes / BYTES_PER_UNIT;
  let unitIndex = 0;
  while (value >= BYTES_PER_UNIT && unitIndex < SIZE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unitIndex += 1;
  }
  const shown =
    value < ONE_DECIMAL_BELOW
      ? value.toFixed(ONE_DECIMAL)
      : String(Math.round(value));
  return `${shown} ${SIZE_UNITS[unitIndex]}`;
}
