import type {
  ChangeKind,
  Side,
  TextSource
} from "@/renderer/shared/api/bindings";

/** 변경 종류(`Change.kind`) */
export const CHANGE_KIND = {
  INSERT: "insert",
  DELETE: "delete",
  REPLACE: "replace"
} as const satisfies Record<string, ChangeKind>;

/** 종류 칩·범례 순서(시안 4: 추가 · 삭제 · 변경) */
export const CHANGE_KINDS: readonly ChangeKind[] = [
  CHANGE_KIND.INSERT,
  CHANGE_KIND.DELETE,
  CHANGE_KIND.REPLACE
];

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  [CHANGE_KIND.INSERT]: "추가",
  [CHANGE_KIND.DELETE]: "삭제",
  [CHANGE_KIND.REPLACE]: "변경"
};

/** 목록 항목의 쪽 배지: 그 변경이 어느 문서에 있나(시안 4) */
export const CHANGE_SIDE_LABEL: Record<ChangeKind, string> = {
  [CHANGE_KIND.INSERT]: "B만",
  [CHANGE_KIND.DELETE]: "A만",
  [CHANGE_KIND.REPLACE]: "A↔B"
};

/** 비교하는 두 문서 쪽(`Side`) */
export const COMPARE_SIDE = {
  BEFORE: "before",
  AFTER: "after"
} as const satisfies Record<string, Side>;

export const COMPARE_SIDES: readonly Side[] = [
  COMPARE_SIDE.BEFORE,
  COMPARE_SIDE.AFTER
];

/** 화면에 보이는 문서 이름(A 이전 · B 이후) */
export const COMPARE_SIDE_BADGE: Record<Side, string> = {
  [COMPARE_SIDE.BEFORE]: "A",
  [COMPARE_SIDE.AFTER]: "B"
};

/** OCR로 읽은 쪽(`page_sources`) */
export const OCR_TEXT_SOURCE = "ocr" satisfies TextSource;

export const COMPARISON_TEXT = {
  /** `needs_review` 변경. 차이 개수에 넣지 않고 따로 센다(ADR 0001 §5). */
  NEEDS_REVIEW: "확인 필요",
  OCR: "OCR"
} as const;

interface ChangeKindStyle {
  /** 범례 칩·목록의 10px 견본(바탕·테두리) */
  swatch: string;
  /** 페이지 위 상자 채움(SVG) */
  fill: string;
  /** 페이지 위 상자 테두리(SVG) */
  stroke: string;
  /** 페이지 위 번호 태그·미니맵 눈금 */
  solid: string;
  /** 테두리 점선 간격(`stroke-dasharray`). 실선이면 `undefined` */
  dashArray?: string;
}

/** 토큰 문서 §2.1: 추가 파랑 실선 · 삭제 주황 실선 · 변경 노랑 점선, 각 `-fill` */
export const CHANGE_KIND_STYLE: Record<ChangeKind, ChangeKindStyle> = {
  [CHANGE_KIND.INSERT]: {
    swatch: "bg-diff-insert-fill border-diff-insert border",
    fill: "fill-diff-insert-fill",
    stroke: "stroke-diff-insert",
    solid: "bg-diff-insert"
  },
  [CHANGE_KIND.DELETE]: {
    swatch: "bg-diff-delete-fill border-diff-delete border",
    fill: "fill-diff-delete-fill",
    stroke: "stroke-diff-delete",
    solid: "bg-diff-delete"
  },
  [CHANGE_KIND.REPLACE]: {
    swatch: "bg-diff-change-fill border-diff-change border border-dashed",
    fill: "fill-diff-change-fill",
    stroke: "stroke-diff-change",
    solid: "bg-diff-change",
    dashArray: "4 3"
  }
};

/**
 * "확인 필요" 표시: 종류 색은 그대로 두고 그 바깥에 `warning-foreground` 점 테두리를 두르고,
 * 번호 태그는 `warning` 채움이다(토큰 문서 §6.5).
 */
export const NEEDS_REVIEW_STYLE = {
  swatch: "bg-warning border-warning-foreground border border-dotted",
  ring: "stroke-warning-foreground",
  tag: "bg-warning text-warning-foreground",
  ringDashArray: "1.5 2.5"
} as const;
