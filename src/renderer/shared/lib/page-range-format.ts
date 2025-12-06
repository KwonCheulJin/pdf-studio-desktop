/**
 * 활성 페이지 번호 배열을 범위 문자열로 변환
 * @param activePageNumbers - 정렬된 활성 페이지 번호 배열 (1-based)
 * @returns 범위 문자열 (예: "1-3, 5-6" 또는 "1, 3-5")
 *
 * @example
 * formatPageRange([1, 2, 3, 5, 6]) // "1-3, 5-6"
 * formatPageRange([1, 3, 4, 5]) // "1, 3-5"
 * formatPageRange([1, 2, 3, 4, 5]) // "1-5"
 * formatPageRange([1]) // "1"
 * formatPageRange([]) // ""
 */
export function formatPageRange(activePageNumbers: number[]): string {
  if (activePageNumbers.length === 0) {
    return "";
  }

  const sorted = [...activePageNumbers].sort((a, b) => a - b);
  const ranges: string[] = [];

  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];

    if (current === rangeEnd + 1) {
      // 연속된 숫자
      rangeEnd = current;
    } else {
      // 범위 종료, 새 범위 시작
      ranges.push(formatRange(rangeStart, rangeEnd));
      rangeStart = current;
      rangeEnd = current;
    }
  }

  // 마지막 범위 추가
  ranges.push(formatRange(rangeStart, rangeEnd));

  return ranges.join(", ");
}

/**
 * 단일 범위를 문자열로 변환
 */
function formatRange(start: number, end: number): string {
  if (start === end) {
    return String(start);
  }
  return `${start}-${end}`;
}
