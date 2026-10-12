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
    Change, ChangeKind, ChangeSide, CompareError, CompareOptions, CompareOptionsError,
    CompareProgress, CompareRequest, CompareResult, CompareStage, DIFF_TIME_LIMIT, DocumentText,
    ExtractedChar, ExtractedPage, ExtractionCache, Glyph, HEADER_FOOTER_BAND_PT,
    LOW_TEXT_CONFIDENCE_RATIO, LineExclusions, NoTextReason, NormalizeOptions, Notice,
    OCR_MIN_CONFIDENCE, OCR_MIN_CONFIDENCE_NUMERIC, OCR_MIN_TEXT_CHARS, OcrFailure, PagePair,
    PageSize, PageSizes, PageSources, ProgressDetail, Side, TextBox, TextComparison, TextSource,
    Token, TokenDiff, UnicodeForm, compare_pdfs, compare_texts, diff_tokens, exclude_lines,
    extract_text_layer, has_low_text_confidence, pair_pages, parse_page_range, read_document_text,
    select_pages, tokenize,
};
pub use document::{DocumentError, MAX_INPUT_FILE_BYTES};
pub use engine::{EngineError, PdfEngine};
pub use info::{PageBox, PageInfo, PageRotation, PdfInfo, read_pdf_info};
pub use merge::{
    MAX_MERGE_FILES, MergeError, MergePage, MergeProgress, MergeRequest, MergeResult, MergeSource,
    MergeStage, merge_pdfs,
};
pub use ocr::{
    MAX_OCR_CACHE_BYTES, OCR_DET_MAX_SIDE, OCR_MODEL_VERSION, OCR_RENDER_DPI, OcrCache, OcrChar,
    OcrEngine, OcrError, OcrLine, Quad, render_page_for_ocr,
};
pub use output::{SaveError, copy_atomically};
pub use tiff::{MAX_TIFF_PAGE_PIXELS, TiffConversion, TiffConversionError, convert_tiff};
