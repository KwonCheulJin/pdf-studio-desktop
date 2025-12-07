import type { ValueOf } from "@/renderer/shared/types/common";
import type { PdfDocument } from "@/renderer/shared/model/pdf-document";

/**
 * 미리보기 모드 상수
 */
export const PREVIEW_MODE = {
  /** 접힌 카드: 전체 페이지 스크롤 */
  DOCUMENT: "document",
  /** 펼친 카드: 단일 페이지 */
  PAGE: "page"
} as const;

export type PreviewMode = ValueOf<typeof PREVIEW_MODE>;

/**
 * 미리보기 대상 정보
 */
export interface PreviewTarget {
  mode: PreviewMode;
  document: PdfDocument;
  /** PAGE 모드에서 표시할 페이지 인덱스 (0-based) */
  initialPageIndex?: number;
  /** DOCUMENT 모드에서 표시할 그룹 페이지 ID 목록 (그룹 분리 시) */
  groupPageIds?: string[];
}

/**
 * 미리보기 렌더링 설정
 */
export const PREVIEW_CONFIG = {
  /** 미리보기용 렌더링 스케일 (고해상도) */
  SCALE: 1.5,
  /** 최대 캐시 페이지 수 (LRU) */
  MAX_CACHE_ENTRIES: 50,
  /** Virtuoso 오버스캔 (뷰포트 외 미리 렌더링할 픽셀) */
  OVERSCAN: 200
} as const;
