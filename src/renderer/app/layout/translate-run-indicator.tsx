import { useTranslateRunStatus } from "@/renderer/features/pdf-translate";

/** 상태바의 번역 진행(계획서 P6-10): "번역 중 50%" */
export const translateRunningText = (percent: number) => `번역 중 ${percent}%`;

/**
 * 다른 모드(홈·병합·비교)의 상태바에 두는 번역 진행. 번역이 돌고 있을 때만 보인다.
 * 번역 화면 상태바는 상태 칸 자체가 이 문구가 된다.
 */
export function TranslateRunIndicator() {
  const { isRunning, overallPercent } = useTranslateRunStatus();
  if (!isRunning) return null;
  return <span role="status">{translateRunningText(overallPercent)}</span>;
}
