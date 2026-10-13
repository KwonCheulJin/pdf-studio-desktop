import type {
  ChangeKind,
  Connector,
  ConnectorEnd,
  Side
} from "@/renderer/entities/comparison";

/** 쪽 위 연결선 끝의 줄 표시 하나(계획서 §7.1, Step 28-d) */
export interface RowBand {
  changeId: string;
  kind: ChangeKind;
  /** 끝 사각형(사용자 공간). 줄 표시의 세로 범위가 된다. */
  bounds: ConnectorEnd["bounds"];
}

/** 쪽 번호 → 그 쪽에 그릴 줄 표시(연결선 순서) */
export type PageRowBands = ReadonlyMap<number, readonly RowBand[]>;

const NO_ROW_BANDS: PageRowBands = new Map();

interface RowBandsByPageParams {
  /** 그릴 연결선(꺼져 있으면 `null`: 줄 표시도 그리지 않는다) */
  connectors: readonly Connector[] | null;
  side: Side;
}

/** 그 문서 쪽의 연결선 끝마다 줄 표시 하나를 끝의 쪽(첫 쪽)별로 모은다. */
export function rowBandsByPage({
  connectors,
  side
}: RowBandsByPageParams): PageRowBands {
  if (!connectors) return NO_ROW_BANDS;
  const byPage = new Map<number, RowBand[]>();
  connectors.forEach(({ change, [side]: end }) => {
    const band = { changeId: change.id, kind: change.kind, bounds: end.bounds };
    const bands = byPage.get(end.bounds.page);
    if (bands) {
      bands.push(band);
    } else {
      byPage.set(end.bounds.page, [band]);
    }
  });
  return byPage;
}
