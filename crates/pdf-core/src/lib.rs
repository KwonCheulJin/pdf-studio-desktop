//! PDF 처리 도메인. Tauri·웹뷰에 의존하지 않는다.

mod document;
mod engine;
mod info;
mod merge;
mod output;
mod tiff;

pub use document::{DocumentError, MAX_INPUT_FILE_BYTES};
pub use engine::{EngineError, PdfEngine};
pub use info::{PageBox, PageInfo, PageRotation, PdfInfo, read_pdf_info};
pub use merge::{
    MAX_MERGE_FILES, MergeError, MergePage, MergeProgress, MergeRequest, MergeResult, MergeSource,
    MergeStage, merge_pdfs,
};
pub use output::{SaveError, copy_atomically};
pub use tiff::{MAX_TIFF_PAGE_PIXELS, TiffConversion, TiffConversionError, convert_tiff};
