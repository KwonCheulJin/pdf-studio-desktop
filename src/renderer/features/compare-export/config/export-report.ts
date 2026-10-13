import type { ErrorCode, ReportLayout } from "@/renderer/shared/api/bindings";
import type { ValueOf } from "@/renderer/shared/types/common";

/** 비교 PDF 한 장의 배치(`ReportLayout`, 시안 5 `A·B 나란히 | A만 | B만`) */
export const REPORT_LAYOUT = {
  SIDE_BY_SIDE: "sideBySide",
  A_ONLY: "aOnly",
  B_ONLY: "bOnly"
} as const satisfies Record<string, ReportLayout>;

export const REPORT_LAYOUTS: readonly ReportLayout[] = [
  REPORT_LAYOUT.SIDE_BY_SIDE,
  REPORT_LAYOUT.A_ONLY,
  REPORT_LAYOUT.B_ONLY
];

export const REPORT_LAYOUT_LABEL: Record<ReportLayout, string> = {
  [REPORT_LAYOUT.SIDE_BY_SIDE]: "A·B 나란히",
  [REPORT_LAYOUT.A_ONLY]: "A만",
  [REPORT_LAYOUT.B_ONLY]: "B만"
};

/** 받을 파일 종류(시안 5 "받을 파일") */
export const EXPORT_FILE_KIND = {
  COMPARE: "compare",
  ANNOTATED: "annotated"
} as const;

export type ExportFileKind = ValueOf<typeof EXPORT_FILE_KIND>;

/** 만드는 순서. 비교 PDF가 먼저다. */
export const EXPORT_FILE_KINDS: readonly ExportFileKind[] = [
  EXPORT_FILE_KIND.COMPARE,
  EXPORT_FILE_KIND.ANNOTATED
];

/** 두 문서 이름 뒤에 붙여 만들 파일 이름의 끝(시안 5 "공급계약서_v1-v2_비교.pdf") */
export const EXPORT_FILE_SUFFIX: Record<ExportFileKind, string> = {
  [EXPORT_FILE_KIND.COMPARE]: "_비교",
  [EXPORT_FILE_KIND.ANNOTATED]: "_주석"
};

export const PDF_FILE_EXTENSION = ".pdf";

/** 두 문서 이름의 같은 머리가 끝나는 글자(이 글자까지를 머리로 본다) */
export const FILE_NAME_SEPARATORS: readonly string[] = ["_", "-", " ", "."];

/** 머리를 뺀 두 이름을 잇는 글자 */
export const FILE_NAME_JOINER = "-";

export const EXPORT_PREVIEW = {
  /** 미리보기 그림 너비(px). 미리보기 칸(최대 332 CSS px)을 기기 픽셀 비율 2로도 또렷하게 그린다. */
  WIDTH_PX: 720,
  /** A4 가로(297 × 210mm) 너비/높이. Rust 장 크기(841.89 × 595.28pt)와 같다. */
  SHEET_ASPECT_RATIO: 297 / 210,
  PNG_DATA_URL_PREFIX: "data:image/png;base64,"
} as const;

/** 미리보기 상태 */
export const PREVIEW_STATUS = {
  /** 비교 PDF를 고르지 않아 그리지 않는다. */
  OFF: "off",
  LOADING: "loading",
  READY: "ready",
  /** 지금 옵션·필터로 넣을 장이 없다(`EMPTY_REPORT`). */
  EMPTY: "empty",
  FAILED: "failed"
} as const;

export type PreviewStatus = ValueOf<typeof PREVIEW_STATUS>;

/** Rust가 같은 상황에서 돌려주는 코드 */
export const EXPORT_ERROR_CODE = {
  EMPTY_REPORT: "EMPTY_REPORT",
  CANCELLED: "CANCELLED"
} as const satisfies Record<string, ErrorCode>;

/** 내보내기 모달 문구(시안 5) */
export const EXPORT_TEXT = {
  OPEN: "내보내기",
  TITLE: "PDF로 내보내기",
  SUBTITLE: "지금 보이는 필터 그대로 내보내요 · 용지는 A4 가로",
  CLOSE: "닫기",
  FILES: "받을 파일",
  COMPARE_PDF: "비교 PDF",
  COMPARE_PDF_DESCRIPTION: "A와 B를 한 장에 나란히 놓고 차이를 표시해요",
  LAYOUT: "쪽 구성",
  CHANGED_ONLY: "차이가 있는 쪽만 넣기",
  DRAW_BOXES: "차이 표시(색 상자) 넣기",
  ANNOTATED_PDF: "주석 PDF",
  ANNOTATED_PDF_DESCRIPTION:
    "B 문서 위에 차이를 주석으로 달아요. Acrobat, 미리보기에서 주석 목록으로 볼 수 있어요",
  LOCATION: "저장 위치",
  LOCATION_EMPTY: "아직 고르지 않았어요",
  PICK_LOCATION: "고르기",
  CHANGE_LOCATION: "바꾸기",
  FILES_TO_CREATE: "만들 파일:",
  NO_FILES_TO_CREATE: "없음",
  PREVIEW: "미리보기",
  PREVIOUS_SHEET: "이전 장",
  NEXT_SHEET: "다음 장",
  PREVIEW_COMPARE_ONLY: "미리보기는 비교 PDF만 보여요.",
  PREVIEW_EMPTY: "지금 필터로는 넣을 쪽이 없어요.",
  PREVIEW_FAILED: "미리보기를 그리지 못했어요.",
  REVIEW_NOT_HIDDEN: "확인 필요 표시는 숨겨도 넣어요.",
  CANCEL: "취소",
  EXPORTING: "내보내는 중…",
  REASON_NO_FILE: "받을 파일을 하나 이상 골라 주세요.",
  REASON_NO_LOCATION: "저장할 폴더를 골라 주세요.",
  REASON_EMPTY_REPORT: "지금 필터로는 비교 PDF에 넣을 쪽이 없어요.",
  PICK_FAILED: "저장 위치를 고르지 못했어요.",
  CANCEL_FAILED: "내보내기를 멈추지 못했어요."
} as const;

export const EXPORT_FAILED_TITLE: Record<ExportFileKind, string> = {
  [EXPORT_FILE_KIND.COMPARE]: "비교 PDF를 만들지 못했어요.",
  [EXPORT_FILE_KIND.ANNOTATED]: "주석 PDF를 만들지 못했어요."
};

/** 아직 모르는 장 수 자리 */
const UNKNOWN_COUNT = "…";

interface PageChangeParams {
  /** 차이 쪽만을 끈 장 수 */
  all: number;
  /** 차이 쪽만 넣을 때의 장 수. 모르면(미리보기를 받는 중) `null` */
  changed: number | null;
}

interface SheetPositionParams {
  current: number;
  total: number;
}

/** 숫자가 들어가는 문구 */
export const exportMessage = {
  /** 바닥 줄 "파일 1개를 만들어요" */
  fileCount: (count: number) => `파일 ${count}개를 만들어요`,
  /** 끝나면 토스트 "PDF 2개를 만들었어요" */
  created: (count: number) => `PDF ${count}개를 만들었어요`,
  /** "(19쪽 → 6쪽)" */
  pageChange: ({ all, changed }: PageChangeParams) =>
    `(${all}쪽 → ${changed === null ? UNKNOWN_COUNT : changed}쪽)`,
  /** "1 / 6장" */
  sheetPosition: ({ current, total }: SheetPositionParams) =>
    `${current} / ${total}장`,
  previewImage: (sheetNumber: number) => `비교 PDF ${sheetNumber}장 미리보기`,
  /** 미리보기로 받은 장이 전체보다 적을 때 */
  previewLimit: (count: number) => `미리보기는 앞 ${count}장까지 보여요.`,
  /** "변경 표시는 지금 필터를 따라요(변경 숨김)." */
  filterNote: (hiddenLabels: readonly string[]) =>
    `변경 표시는 지금 필터를 따라요(${
      hiddenLabels.length > 0
        ? `${hiddenLabels.join("·")} 숨김`
        : "숨긴 종류 없음"
    }).`
} as const;
