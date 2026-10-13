import { useEffect, useState } from "react";

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_WIDTH = 2;
const PAD_CHARACTER = "0";

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

/** 경과 시간 "0:04", "12:30" */
export function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(
    SECONDS_WIDTH,
    PAD_CHARACTER
  );
  return `${minutes}:${seconds}`;
}
