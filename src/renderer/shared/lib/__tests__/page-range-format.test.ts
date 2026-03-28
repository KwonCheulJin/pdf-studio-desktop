import { describe, it, expect } from "vitest";
import { formatPageRange } from "../page-range-format";

describe("formatPageRange", () => {
  it("빈 배열이면 빈 문자열 반환", () => {
    expect(formatPageRange([])).toBe("");
  });

  it("단일 페이지면 숫자 그대로 반환", () => {
    expect(formatPageRange([3])).toBe("3");
  });

  it("연속된 전체 범위를 하나의 범위로 반환", () => {
    expect(formatPageRange([1, 2, 3, 4, 5])).toBe("1-5");
  });

  it("비연속 페이지를 쉼표로 구분하여 반환", () => {
    expect(formatPageRange([1, 3, 5])).toBe("1, 3, 5");
  });

  it("혼합된 연속·비연속 범위를 올바르게 반환", () => {
    expect(formatPageRange([1, 2, 3, 5, 6])).toBe("1-3, 5-6");
  });

  it("앞 단독, 뒤 범위를 올바르게 반환", () => {
    expect(formatPageRange([1, 3, 4, 5])).toBe("1, 3-5");
  });

  it("정렬되지 않은 입력도 올바르게 처리", () => {
    expect(formatPageRange([5, 1, 3, 2, 4])).toBe("1-5");
  });

  it("두 페이지 범위를 올바르게 반환", () => {
    expect(formatPageRange([2, 3])).toBe("2-3");
  });

  it("여러 단독 페이지를 쉼표로 구분하여 반환", () => {
    expect(formatPageRange([1, 3, 7, 10])).toBe("1, 3, 7, 10");
  });
});
