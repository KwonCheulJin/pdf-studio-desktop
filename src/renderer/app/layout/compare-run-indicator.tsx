import { useCompareRunStatus } from "@/renderer/features/pdf-compare";

/** 상태바의 비교 진행(계획서 P3-3a): "비교 중 49%" */
export const compareRunningText = (percent: number) => `비교 중 ${percent}%`;

/**
 * 다른 모드(홈·병합)의 상태바에 두는 비교 진행. 비교가 돌고 있을 때만 보인다.
 * 비교 화면 상태바는 상태 칸 자체가 이 문구가 된다.
 */
export function CompareRunIndicator() {
  const { isRunning, overallPercent } = useCompareRunStatus();
  if (!isRunning) return null;
  return <span role="status">{compareRunningText(overallPercent)}</span>;
}
