import { useEffect, useState } from "react";
import {
  acquireRenderedPage,
  getRenderedPageKey,
  type RenderedPageRequest
} from "./pdf-cache";

export interface UseRenderedPageParams extends RenderedPageRequest {
  /** false면 그리지 않는다(화면 밖 등). 이미 받은 URL은 그대로 둔다. */
  isEnabled: boolean;
}

export interface UseRenderedPageResult {
  url: string | null;
  isLoading: boolean;
  hasError: boolean;
}

interface RenderedPageState {
  key: string;
  url: string | null;
  hasError: boolean;
}

/**
 * 페이지 렌더 결과(`blob:` URL)를 캐시에서 받는다.
 * 켜져 있는 동안 문서와 렌더 결과를 잡고, 꺼지거나 사라지면 놓는다.
 */
export function useRenderedPage({
  path,
  pageIndex,
  scale,
  rotation,
  isEnabled
}: UseRenderedPageParams): UseRenderedPageResult {
  const key = getRenderedPageKey({ path, pageIndex, scale, rotation });
  const [state, setState] = useState<RenderedPageState | null>(null);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    const lease = acquireRenderedPage({ path, pageIndex, scale, rotation });
    let isActive = true;
    lease.urlPromise.then(
      (url) => {
        if (isActive) {
          setState({ key, url, hasError: false });
        }
      },
      () => {
        if (isActive) {
          setState({ key, url: null, hasError: true });
        }
      }
    );
    return () => {
      isActive = false;
      lease.release();
    };
  }, [key, path, pageIndex, scale, rotation, isEnabled]);

  const current = state?.key === key ? state : null;
  return {
    url: current?.url ?? null,
    isLoading: isEnabled && current === null,
    hasError: current?.hasError ?? false
  };
}
