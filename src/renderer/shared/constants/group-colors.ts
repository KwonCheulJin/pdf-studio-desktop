/**
 * 펼쳐진 파일 그룹을 구분하기 위한 테두리 색상
 * 여러 파일이 펼쳐져 있을 때 각 파일 그룹을 시각적으로 구분
 */
export const GROUP_COLORS = [
  "border-yellow-500",
  "border-blue-500",
  "border-green-500",
  "border-purple-500",
  "border-pink-500"
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

/**
 * 펼쳐진 파일 인덱스에 해당하는 그룹 색상 반환
 */
export function getGroupColor(expandedIndex: number): GroupColor {
  return GROUP_COLORS[expandedIndex % GROUP_COLORS.length];
}
