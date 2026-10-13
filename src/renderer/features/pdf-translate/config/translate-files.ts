/** 한 번에 번역하는 문서 수 */
export const TRANSLATE_FILE_COUNT = 1;

export const TRANSLATE_INTAKE_MESSAGE = {
  TOO_MANY_TITLE: "번역할 파일은 1개까지 넣을 수 있어요.",
  TOO_MANY_DESCRIPTION: "번역할 PDF 하나를 골라 주세요.",
  PICK_FAILED_TITLE: "번역할 파일을 고르지 못했습니다.",
  OPEN_FAILED_TITLE: "번역할 파일을 열지 못했어요.",
  NOT_PDF_DESCRIPTION:
    "PDF만 번역할 수 있어요. TIFF는 병합에서 PDF로 저장한 뒤 넣어 주세요."
} as const;

/** 파일 이름이 들어가는 알림 제목 */
export const translateFileMessage = {
  notPdfTitle: (fileName: string) => `"${fileName}" 파일은 번역할 수 없어요.`,
  openFailedTitle: (fileName: string) => `"${fileName}" 파일을 열 수 없어요.`
} as const;

/**
 * 파일 카드 썸네일(첫 쪽) 렌더 설정. 화면에서는 높이 102px로 줄여 보인다.
 * A4 세로(842pt)를 0.25배로 그리면 약 210px라 레티나에서도 흐리지 않다.
 */
export const TRANSLATE_THUMBNAIL_RENDER = {
  SCALE: 0.25,
  FIRST_PAGE_INDEX: 0
} as const;
