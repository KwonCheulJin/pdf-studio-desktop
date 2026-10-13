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
mod paragraph;
mod per_mille;
mod plan;
mod progress;
mod record;
mod record_key;
mod request;
mod response;
mod retry;
mod runner;
mod script;
mod source;
mod usage;
mod verify;

pub use chunk::{
    Chunk, ChunkEstimate, ChunkItem, Fragment, ScanChunk, TextChunk, build_chunks,
    estimate_text_items, estimated_cost_micro_usd,
};
pub use client::{Attempt, FailReason, ItemOutcome, MessagesClient, ScanOutcome};
pub use error::{ApiError, ApiErrorCode};
pub use glossary::{
    Glossary, GlossaryTerm, GlossaryTooLarge, MAX_GLOSSARY_TERM_CHARS, MAX_GLOSSARY_TERMS,
};
pub use http::{
    ANTHROPIC_API_BASE, ANTHROPIC_VERSION, HttpResponse, ReqwestTransport, Transport,
    TransportError,
};
pub use key::{API_KEY_MAX_LEN, API_KEY_PREFIX, ApiKey, InvalidApiKey};
pub use language::{DetectedLanguage, Language, detect_language};
pub use models::{ModelSpec, Thinking, TranslateModel};
pub use paragraph::{
    LocatedParagraph, ParagraphNotFound, ParagraphTarget, RetranslateError, Retranslated,
    edit_translated_paragraph, locate_paragraph, retranslate_paragraph,
};
pub use plan::{PlanInput, ResumeState, TranslationPlan, plan_translation};
pub use progress::{ProgressReporter, TranslateProgress, TranslateStage};
pub use record::{
    TranslationRecord, delete_translation_records, has_translation_records, load_translation_record,
};
pub use record_key::{TranslationOptions, file_sha256, paragraph_key};
pub use request::PROMPT_VERSION;
pub use response::ScanParagraph;
pub use runner::{
    PageFailure, PageKind, ParagraphStatus, RunError, ScanRenderer, TranslatedPage,
    TranslatedParagraph, TranslationJob, TranslationOutput, run_translation,
};
pub use source::{ScanImage, SourcePage, SourcePageContent, SourceParagraph};
pub use usage::TokenUsage;
pub use verify::verify_api_key;
