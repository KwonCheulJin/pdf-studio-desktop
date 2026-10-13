import type { UpdateDownloadProgress } from "@/renderer/shared/platform";

const PERCENT_SCALE = 100;
/** 받기가 끝나기 전에는 100을 보이지 않는다(진행률 불변식). 끝나면 설치 단계로 넘어간다. */
const MAX_PERCENT_BEFORE_DONE = 99;

/** 받은 비율(%, 정수 내림). 전체 크기를 모르면 `null` */
export function downloadPercent({
  downloadedBytes,
  totalBytes
}: UpdateDownloadProgress): number | null {
  if (totalBytes === null || totalBytes <= 0) return null;
  return Math.min(
    Math.floor((downloadedBytes / totalBytes) * PERCENT_SCALE),
    MAX_PERCENT_BEFORE_DONE
  );
}
