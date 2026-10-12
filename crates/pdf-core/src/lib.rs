//! PDF 처리 도메인. Tauri·웹뷰에 의존하지 않는다.

mod compare;
mod document;
mod engine;
mod info;
mod merge;
mod ocr;
mod output;
mod tiff;

pub use compare::{
    AnnotatedReport, Change, ChangeKind, ChangeSide, CompareOptions, CompareOptionsError,
    CompareReport, CompareReportOptions, CompareResult, DIFF_TIME_LIMIT, ExtractedChar,
    ExtractedPage, Glyph, HEADER_FOOTER_BAND_PT, LOW_TEXT_CONFIDENCE_RATIO, LineExclusions,
    MAX_PREVIEW_WIDTH_PX, NoTextReason, NormalizeOptions, Notice, OCR_MIN_TEXT_CHARS, PagePair,
    PageSize, PageSizes, PageSources, ReportError, ReportLayout, ReportPreview, ReportSources,
    Side, TextBox, TextSource, Token, TokenDiff, UnicodeForm, diff_tokens, exclude_lines,
    export_annotated_pdf, export_compare_pdf, extract_text_layer, has_low_text_confidence,
    pair_pages, parse_page_range, preview_compare_report, select_pages, tokenize,
};
pub use document::{DocumentError, MAX_INPUT_FILE_BYTES};
pub use engine::{EngineError, PdfEngine};
pub use info::{PageBox, PageInfo, PageRotation, PdfInfo, read_pdf_info};
pub use merge::{
    MAX_MERGE_FILES, MergeError, MergePage, MergeProgress, MergeRequest, MergeResult, MergeSource,
    MergeStage, merge_pdfs,
};
pub use ocr::{
    OCR_DET_MAX_SIDE, OCR_RENDER_DPI, OcrChar, OcrEngine, OcrError, OcrLine, Quad,
    render_page_for_ocr,
};
pub use output::{SaveError, copy_atomically};
pub use tiff::{MAX_TIFF_PAGE_PIXELS, TiffConversion, TiffConversionError, convert_tiff};
