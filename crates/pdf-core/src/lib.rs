//! PDF 처리 도메인. Tauri·웹뷰에 의존하지 않는다.

mod compare;
mod document;
mod engine;
mod info;
mod merge;
mod ocr;
mod output;
mod paragraphs;
mod tiff;

pub use compare::{
    AnnotatedReport, Change, ChangeKind, CompareError, CompareOptions, CompareOptionsError,
    CompareProgress, CompareReport, CompareReportOptions, CompareRequest, CompareResult,
    CompareStage, ComparedPages, Connector, ConnectorEnd, ConnectorShape, DIFF_TIME_LIMIT,
    DocumentText, ExtractedChar, ExtractedPage, ExtractionCache, Glyph, HEADER_FOOTER_BAND_PT,
    LOW_TEXT_CONFIDENCE_RATIO, LineExclusions, MAX_PREVIEW_WIDTH_PX, NoTextReason,
    NormalizeOptions, Notice, OCR_MIN_CONFIDENCE, OCR_MIN_CONFIDENCE_NUMERIC, OCR_MIN_TEXT_CHARS,
    OcrFailure, PagePair, PageSize, PageSizes, PageSources, Placement, ProgressDetail, ReportError,
    ReportLayout, ReportPreview, ReportSources, Side, TextBox, TextComparison, TextSource, Token,
    TokenDiff, UnicodeForm, compare_pdfs, compare_texts, connectors, diff_tokens, exclude_lines,
    export_annotated_pdf, export_compare_pdf, extract_text_layer, has_low_text_confidence,
    pair_pages, parse_page_range, preview_compare_report, read_document_text, select_pages,
    tokenize,
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
pub use paragraphs::{
    PageParagraphs, Paragraph, ParagraphError, ParagraphPage, SCAN_IMAGE_MAX_EDGE_PX,
    extract_paragraphs, render_scan_page, scan_image_size, scan_page_flags,
};
pub use tiff::{MAX_TIFF_PAGE_PIXELS, TiffConversion, TiffConversionError, convert_tiff};
