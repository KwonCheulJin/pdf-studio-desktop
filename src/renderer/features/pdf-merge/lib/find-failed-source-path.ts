import type {
  MergeProgress,
  MergeSource
} from "@/renderer/shared/api/bindings";
import { MERGE_STAGE } from "../config/merge-stage";
import { SOURCE_FILE_ERROR_CODES } from "../config/merge-failure";

const FULL_PERCENT = 100;

interface FindFailedSourcePathParams {
  code: string;
  /** 실패 전에 받은 마지막 진행률 */
  progress: MergeProgress | null;
  sources: MergeSource[];
}

/**
 * 병합 실패가 가리키는 소스 파일 경로. 특정할 수 없으면 `null`.
 *
 * 오류(`{ code, message }`)에는 파일 정보가 없어 진행률로 찾는다. 파일 읽기 단계는
 * 소스를 순서대로 하나씩 열고 하나를 끝낼 때마다 `done`을 보고하므로,
 * 마지막 보고가 `done = n`이면 n번째(0부터) 소스를 열다 실패한 것이다.
 * 진행률은 값(단계 %)이 바뀔 때만 오기 때문에, 다음 파일을 끝냈어도 단계 %가
 * 같았다면 보고가 생략됐을 수 있다. 그때는 어느 파일인지 확정할 수 없어 `null`이다.
 */
export function findFailedSourcePath({
  code,
  progress,
  sources
}: FindFailedSourcePathParams): string | null {
  if (!SOURCE_FILE_ERROR_CODES.has(code) || progress === null) return null;
  const { stage, done, total, stagePercent } = progress;
  if (stage !== MERGE_STAGE.READ_FILES) return null;
  if (total !== sources.length || done >= total) return null;
  const nextStagePercent = Math.floor(((done + 1) * FULL_PERCENT) / total);
  if (nextStagePercent === stagePercent) return null;
  return sources[done].path;
}
