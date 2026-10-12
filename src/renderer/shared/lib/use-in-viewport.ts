import { useCallback, useState } from "react";

export interface UseInViewportParams {
  /** 화면 경계를 넓히는 여백(CSS margin 문법). 스크롤 직전에 미리 보이게 할 때 쓴다. */
  rootMargin: string;
}

export interface UseInViewportResult<T extends Element> {
  ref: (element: T | null) => (() => void) | undefined;
  isInViewport: boolean;
}

/** 요소가 화면(여백 포함)과 겹치는지. 붙인 요소가 사라지면 관찰을 끝낸다. */
export function useInViewport<T extends Element>({
  rootMargin
}: UseInViewportParams): UseInViewportResult<T> {
  const [isInViewport, setIsInViewport] = useState(false);

  const ref = useCallback(
    (element: T | null) => {
      if (!element) {
        return undefined;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          const latest = entries[entries.length - 1];
          if (latest) {
            setIsInViewport(latest.isIntersecting);
          }
        },
        { rootMargin }
      );
      observer.observe(element);
      return () => observer.disconnect();
    },
    [rootMargin]
  );

  return { ref, isInViewport };
}
