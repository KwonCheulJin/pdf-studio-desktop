//! 번역 도메인(계획서 §9.1.2, ADR 0002). Tauri·pdfium·키체인을 모르고 pdf-core 타입도 받지 않는다.
//! `src-tauri`가 pdf-core 문단 추출 결과를 [`SourcePage`]로 옮겨 넘긴다(ADR 0002 §1, 계획서 Q10).

mod chunk;
mod client;
mod error;
mod glossary;
mod http;
mod key;
mod language;
mod models;
mod per_mille;
mod request;
mod response;
mod retry;
mod script;
mod source;
mod usage;

pub use chunk::{
    Chunk, ChunkEstimate, ChunkItem, Fragment, ScanChunk, TextChunk, build_chunks,
    estimated_cost_micro_usd,
};
pub use client::{Attempt, FailReason, ItemOutcome, MessagesClient, ScanOutcome};
pub use error::{ApiError, ApiErrorCode};
pub use glossary::{Glossary, GlossaryTerm};
pub use http::{
    ANTHROPIC_API_BASE, ANTHROPIC_VERSION, HttpResponse, ReqwestTransport, Transport,
    TransportError,
};
pub use key::{ApiKey, InvalidApiKey};
pub use language::{DetectedLanguage, Language, detect_language};
pub use models::{ModelSpec, Thinking, TranslateModel};
pub use request::PROMPT_VERSION;
pub use response::ScanParagraph;
pub use source::{ScanImage, SourcePage, SourcePageContent, SourceParagraph};
pub use usage::TokenUsage;
