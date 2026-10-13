import { useEffect, useState } from "react";
import { acquirePageGeometry } from "./pdf-cache";
import type { PageGeometry } from "./page-geometry";

export interface UsePageGeometriesParams {
  path: string;
  /** 0부터 센 쪽 번호들 */
  pages: readonly number[];
}

interface PageGeometriesState {
  key: string;
  geometries: ReadonlyMap<number, PageGeometry>;
}

/**
 * 여러 쪽의 화면 변환을 한 번에 받는다(그리지 않는다). 화면에 놓이지 않은 쪽의 변환이 필요할 때 쓴다.
 * 모두 받으면(실패한 쪽은 빼고) 한 번에 돌려주고, 받기 전에는 `null`이다. 쓰는 동안 문서를 잡는다.
 */
export function usePageGeometries({
  path,
  pages
}: UsePageGeometriesParams): ReadonlyMap<number, PageGeometry> | null {
  const key = JSON.stringify([path, pages]);
  const [state, setState] = useState<PageGeometriesState | null>(null);

  useEffect(() => {
    const leases = pages.map((pageIndex) => ({
      pageIndex,
      lease: acquirePageGeometry({ path, pageIndex })
    }));
    let isActive = true;
    Promise.allSettled(leases.map(({ lease }) => lease.geometryPromise)).then(
      (settled) => {
        if (!isActive) return;
        const geometries = new Map(
          settled.flatMap((outcome, index) =>
            outcome.status === "fulfilled"
              ? [[leases[index].pageIndex, outcome.value] as const]
              : []
          )
        );
        setState({ key, geometries });
      }
    );
    return () => {
      isActive = false;
      leases.forEach(({ lease }) => lease.release());
    };
  }, [key]);

  return state?.key === key ? state.geometries : null;
}
