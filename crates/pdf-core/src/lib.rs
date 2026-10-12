//! PDF 처리 도메인. Tauri·웹뷰에 의존하지 않는다.

mod engine;

pub use engine::{EngineError, PdfEngine};
