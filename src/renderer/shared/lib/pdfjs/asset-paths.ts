/**
 * pdf.js가 런타임에 읽는 자산 폴더(앱 루트 기준, 끝에 `/` 필수 — pdf.js가 파일 이름을 바로 붙인다).
 * `vite.config.ts`가 같은 상수로 `pdfjs-dist`의 폴더를 빌드 결과에 복사하고 개발 서버에서 내준다.
 */
export const PDFJS_ASSET_DIRECTORY = {
  /** 미리 정의된 Adobe CMap. 한글·CJK CID 폰트를 그리려면 필수다. */
  CMAPS: "pdfjs/cmaps/",
  /** 임베드되지 않은 표준 14 폰트 대체 글꼴 */
  STANDARD_FONTS: "pdfjs/standard_fonts/",
  /** JPX·JBIG2 디코더와 색 관리(qcms) */
  WASM: "pdfjs/wasm/",
  /** CMYK 변환용 ICC 프로필 */
  ICCS: "pdfjs/iccs/"
} as const;
