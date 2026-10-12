import { useEffect, useRef } from "react";
import { retainPdfDocument } from "./pdf-cache";

type ReleaseByPath = Map<string, () => void>;

/**
 * 주어진 경로의 문서 참조를 잡아 둔다. 읽기는 처음 그릴 때 하고, 한 번 읽은 문서는
 * 화면(카드·미리보기)이 바뀌어도 다시 읽지 않는다. 목록에서 빠진 경로는 놓아
 * 마지막 참조였다면 문서를 닫는다.
 */
export function usePdfDocumentRetention(paths: readonly string[]): void {
  const releaseByPathRef = useRef<ReleaseByPath>(new Map());

  // 바뀐 만큼만 잡고 놓는다. 그대로인 경로를 놓았다 다시 잡으면 문서를 닫고 다시 읽는다.
  useEffect(() => {
    const previous = releaseByPathRef.current;
    const next: ReleaseByPath = new Map(
      Array.from(new Set(paths), (path) => [
        path,
        previous.get(path) ?? retainPdfDocument(path)
      ])
    );
    previous.forEach((release, path) => {
      if (!next.has(path)) {
        release();
      }
    });
    releaseByPathRef.current = next;
  }, [paths]);

  useEffect(
    () => () => {
      releaseByPathRef.current.forEach((release) => release());
      releaseByPathRef.current = new Map();
    },
    []
  );
}
