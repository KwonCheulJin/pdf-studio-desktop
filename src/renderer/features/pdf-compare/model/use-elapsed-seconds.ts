import { useEffect, useState } from "react";

const MILLISECONDS_PER_SECOND = 1000;

/** `startedAt`(`Date.now()`)부터 지난 초. 1초마다 다시 그린다. 시작 전이면 0 */
export function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return undefined;
    const timer = window.setInterval(
      () => setNow(Date.now()),
      MILLISECONDS_PER_SECOND
    );
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (startedAt === null) return 0;
  return Math.max(0, Math.floor((now - startedAt) / MILLISECONDS_PER_SECOND));
}
