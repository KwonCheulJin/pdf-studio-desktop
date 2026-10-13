import {
  RESULT_VIEW_MODE,
  type ResultViewMode
} from "@/renderer/features/pdf-translate";
import { PAGE_KIND } from "@/renderer/entities/translation";
import type { PageKind } from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";

/** 대역 보기의 한쪽 패널 */
export const PANEL_SIDE = {
  SOURCE: "source",
  TARGET: "target"
} as const;

export type PanelSide = ValueOf<typeof PANEL_SIDE>;

/** 보기 방식 순서(시안 13 `나란히 | 번역만 | 원문만`) */
export const VIEW_MODE_ORDER: readonly ResultViewMode[] = [
  RESULT_VIEW_MODE.SIDE_BY_SIDE,
  RESULT_VIEW_MODE.TARGET_ONLY,
  RESULT_VIEW_MODE.SOURCE_ONLY
];

export const VIEW_MODE_LABEL: Record<ResultViewMode, string> = {
  [RESULT_VIEW_MODE.SIDE_BY_SIDE]: "나란히",
  [RESULT_VIEW_MODE.TARGET_ONLY]: "번역만",
  [RESULT_VIEW_MODE.SOURCE_ONLY]: "원문만"
};

/** 보기 방식마다 보이는 패널(왼쪽부터) */
export const VIEW_MODE_SIDES: Record<ResultViewMode, readonly PanelSide[]> = {
  [RESULT_VIEW_MODE.SIDE_BY_SIDE]: [PANEL_SIDE.SOURCE, PANEL_SIDE.TARGET],
  [RESULT_VIEW_MODE.TARGET_ONLY]: [PANEL_SIDE.TARGET],
  [RESULT_VIEW_MODE.SOURCE_ONLY]: [PANEL_SIDE.SOURCE]
};

export const PANEL_LABEL: Record<PanelSide, string> = {
  [PANEL_SIDE.SOURCE]: "원문",
  [PANEL_SIDE.TARGET]: "번역"
};

interface PanelTextSize {
  fontPx: number;
  lineHeightPx: number;
}

/** 배율 100%의 문단 글자 크기·줄 높이(시안 13: 원문 13/22, 번역 14/23). 배율은 둘에 곱한다. */
export const PANEL_TEXT_SIZE: Record<PanelSide, PanelTextSize> = {
  [PANEL_SIDE.SOURCE]: { fontPx: 13, lineHeightPx: 22 },
  [PANEL_SIDE.TARGET]: { fontPx: 14, lineHeightPx: 23 }
};

export const PERCENT_BASE = 100;

export const VIEWER_TEXT = {
  VIEW_MODE: "보기 방식",
  GLOSSARY: "용어집",
  GLOSSARY_NOTE: "용어집을 바꾸면 다시 번역해야 반영돼요.",
  PREVIOUS_PAGE: "이전 쪽",
  NEXT_PAGE: "다음 쪽",
  PAGE_NUMBER: "쪽 번호",
  ZOOM_OUT: "축소",
  ZOOM_IN: "확대",
  ZOOM_LEVEL: "배율",
  IMAGE_SOURCE: "이미지에서 읽음",
  EDITED: "고침",
  /** 스캔 쪽 그림을 보냈지만 그 쪽 자체가 실패했을 때(`TranslatedPage.failCode`) 이유 앞 */
  IMAGE_PAGE_FAILED: "이 쪽 그림을 읽지 못했어요."
} as const;

/** 문단이 없는 쪽의 자리표시(계획서 P6-11 "쪽 종류"). 받아 적은 글이 없는 이미지 쪽은 글 없는 쪽과 같다. */
export const EMPTY_PAGE_TEXT: Record<PageKind, string> = {
  [PAGE_KIND.SCAN_SKIPPED]:
    "스캔 쪽이라 번역하지 않았어요. 스캔 페이지 옵션을 켜고 다시 번역할 수 있어요.",
  [PAGE_KIND.OUT_OF_RANGE]: "번역 범위 밖 쪽이에요.",
  [PAGE_KIND.TEXT_LAYER]: "이 쪽에는 번역할 글이 없어요.",
  [PAGE_KIND.IMAGE]: "이 쪽에는 번역할 글이 없어요."
};

interface PanelCaptionParams {
  side: PanelSide;
  /** 1부터 센 쪽 번호 */
  pageNumber: number;
}

/** 숫자가 들어가는 문구 */
export const viewerText = {
  glossaryButton: (count: number) => `${VIEWER_TEXT.GLOSSARY} ${count}`,
  /** 패널 머리 `원문 · 3쪽` */
  panelCaption: ({ side, pageNumber }: PanelCaptionParams) =>
    `${PANEL_LABEL[side]} · ${pageNumber}쪽`,
  /** 쪽 이동의 전체 쪽 `/ 24쪽` */
  pageTotal: (count: number) => `/ ${count}쪽`,
  zoomPercent: (percent: number) => `${percent}%`
} as const;
