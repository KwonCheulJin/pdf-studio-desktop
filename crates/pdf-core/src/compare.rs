//! 두 PDF의 글자를 비교한다. 결과 모델과 좌표 규칙의 정본은
//! `docs/adr/0001-compare-result-model.md`다.

mod diff;
mod extract;
mod model;
mod ocr_text;
mod options;
mod pages;
mod pipeline;
mod review;
mod tokenize;

pub use diff::{DIFF_TIME_LIMIT, TokenDiff, diff_tokens};
pub use extract::{ExtractedChar, ExtractedPage, Glyph, OCR_MIN_TEXT_CHARS, extract_text_layer};
pub use model::{
    Change, ChangeKind, ChangeSide, CompareResult, NoTextReason, Notice, PagePair, PageSize,
    PageSizes, PageSources, Side, TextBox, TextSource,
};
pub use options::{
    CompareOptions, CompareOptionsError, HEADER_FOOTER_BAND_PT, LineExclusions, exclude_lines,
    parse_page_range, select_pages,
};
pub use pages::pair_pages;
pub use pipeline::{
    CompareError, DocumentText, OcrFailure, TextComparison, compare_texts, read_document_text,
};
pub use review::{OCR_MIN_CONFIDENCE, OCR_MIN_CONFIDENCE_NUMERIC};
pub use tokenize::{
    LOW_TEXT_CONFIDENCE_RATIO, NormalizeOptions, Token, UnicodeForm, has_low_text_confidence,
    tokenize,
};
