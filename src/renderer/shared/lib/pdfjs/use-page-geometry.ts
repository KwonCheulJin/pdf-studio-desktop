import { useEffect, useState } from "react";
import { acquirePageGeometry, type PageGeometryRequest } from "./pdf-cache";
import type { PageGeometry } from "./page-geometry";

export interface UsePageGeometryParams extends PageGeometryRequest {
  /** false면 문서를 잡지 않는다(그릴 상자가 없을 때 등). */
  isEnabled: boolean;
}

interface PageGeometryState {
  key: string;
  geometry: PageGeometry | null;
}

/**
 * 쪽의 화면 변환을 받는다. 켜져 있는 동안 문서를 잡고, 꺼지거나 사라지면 놓는다.
 * 받기 전이나 실패하면 `null`이다.
 */
export function usePageGeometry({
  path,
  pageIndex,
  isEnabled
}: UsePageGeometryParams): PageGeometry | null {
  const key = JSON.stringify([path, pageIndex]);
  const [state, setState] = useState<PageGeometryState | null>(null);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    const lease = acquirePageGeometry({ path, pageIndex });
    let isActive = true;
    lease.geometryPromise.then(
      (geometry) => {
        if (isActive) {
          setState({ key, geometry });
        }
      },
      () => {
        if (isActive) {
          setState({ key, geometry: null });
        }
      }
    );
    return () => {
      isActive = false;
      lease.release();
    };
  }, [key, path, pageIndex, isEnabled]);

  return state?.key === key ? state.geometry : null;
}
