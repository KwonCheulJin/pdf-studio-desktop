//! 문단 하나 다시 번역·직접 고치기(ADR 0002 §5 "다시 번역", §8, §10 `retranslate_paragraph`·
//! `edit_translated_paragraph`). 결과 화면이 보낸 기록 키(`record_id`)가 지금 파일·옵션으로 다시 센 기록 키와
//! 같을 때만 기록을 고친다.
//!
//! - 찾기([`locate_paragraph`]): 글자층 문단은 지금 추출한 범위 쪽에서, 스캔 쪽 문단은 기록의 받아 적은 문단에서
//!   문단 키로 찾는다. 기록 파일이 아직 없으면(첫 실행의 문단이 모두 실패했다) 새 기록으로 시작한다.
//! - 다시 번역: 그 문단 하나(ID `"1"`)와 문서 순서의 앞·뒤 문단 원문(같은 쪽이 아니어도)을 보낸다. 번역을 받으면
//!   기록의 번역을 바꾸고 직접 고친 글을 지운다. 검증 실패·잘림·거절이면 기록의 글은 그대로 두고 그 상태의 문단을
//!   돌려준다(화면이 알리고 원래 글을 둔다). 받은 사용량은 기록 누적에 더한다. 긴 문단도 조각으로 나누지 않는다.
//! - 직접 고치기: 앞뒤 공백을 지운 글을 `edited`로 둔다. 빈 글이면 `edited`를 지워 원래 번역으로 돌리고, 번역이
//!   없는(실패한) 문단은 기록에서 빼 다음 이어하기가 다시 보내게 한다.
//! - 문단이 하나도 없는 새 기록은 파일로 쓰지 않는다(실행기와 같다).

use std::io;
use std::path::Path;
use std::slice;
use std::sync::atomic::AtomicBool;

use crate::chunk::{ChunkItem, TextChunk, estimate_text_items};
use crate::client::{ItemOutcome, MessagesClient};
use crate::error::ApiError;
use crate::glossary::GlossaryTerm;
use crate::http::Transport;
use crate::key::ApiKey;
use crate::language::Language;
use crate::models::TranslateModel;
use crate::record::{Record, RecordStore, RecordedParagraph};
use crate::record_key::{TranslationOptions, paragraph_key};
use crate::request::RequestContext;
use crate::runner::{
    MISSING_RESULT, ParagraphStatus, TranslatedParagraph, recorded_status, until_cancelled,
};
use crate::source::{SourcePage, SourcePageContent};
use crate::usage::TokenUsage;

/// 고칠 문단
pub struct ParagraphTarget<'a> {
    /// 범위 안 쪽(번역할 때와 같은 범위, 쪽 번호 오름차순)
    pub pages: &'a [SourcePage],
    pub options: TranslationOptions<'a>,
    /// 이어하기 기록 폴더
    pub record_dir: &'a Path,
    /// 결과의 기록 키(`record_id`)
    pub record_key: &'a str,
    /// 문단 키
    pub key: &'a str,
}

/// 기록 키가 다르거나 문단이 없다(`TRANSLATION_RECORD_NOT_FOUND`)
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("번역 기록이나 문단을 찾지 못했다")]
pub struct ParagraphNotFound;

/// 다시 번역이 멈춘 이유
#[derive(Debug, thiserror::Error)]
pub enum RetranslateError {
    /// 취소 토큰이 켜졌다(`CANCELLED`). 끊긴 요청의 사용량은 알 수 없어 더하지 않는다.
    #[error("CANCELLED")]
    Cancelled,
    #[error(transparent)]
    Api(ApiError),
}

/// 다시 번역한 문단과 이 요청의 사용량
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Retranslated {
    pub paragraph: TranslatedParagraph,
    pub usage: TokenUsage,
}

/// 기록 안 문단 자리
#[derive(Debug, Clone, Copy)]
enum Slot {
    /// 글자층 문단(기록 `paragraphs`)
    Text,
    /// 스캔 쪽의 받아 적은 문단(기록 `scanPages[page][index]`)
    Scan { page: u32, index: usize },
}

/// 찾은 문단과 그 기록
pub struct LocatedParagraph {
    store: RecordStore,
    record: Record,
    /// 기록 파일이 있었다(없었고 문단이 하나도 없으면 쓰지 않는다)
    existed: bool,
    slot: Slot,
    key: String,
    page: u32,
    number: u32,
    source: String,
    heading: bool,
    context: RequestContext,
    glossary: Vec<GlossaryTerm>,
    language: Language,
    model: TranslateModel,
}

/// 문단 하나(문서 순서 목록의 항목)
struct Entry {
    slot: Slot,
    key: String,
    page: u32,
    number: u32,
    source: String,
    heading: bool,
}

/// 기록 키를 맞춰 보고 문단을 찾는다. 키·기록을 읽기만 하고 아무것도 쓰지 않는다.
pub fn locate_paragraph(
    target: ParagraphTarget<'_>,
) -> Result<LocatedParagraph, ParagraphNotFound> {
    let record_key = target.options.record_key();
    if record_key != target.record_key {
        return Err(ParagraphNotFound);
    }
    let store = RecordStore::new(target.record_dir);
    let (record, existed) = match store.load(&record_key) {
        Some(record) => (record, true),
        None => (Record::new(&record_key), false),
    };
    let entries = document_entries(target.pages, target.options.include_scan_pages, &record);
    let index = entries
        .iter()
        .position(|entry| entry.key == target.key)
        .ok_or(ParagraphNotFound)?;
    let source_of = |index: Option<usize>| {
        index
            .and_then(|index| entries.get(index))
            .map(|entry| entry.source.clone())
    };
    let context = RequestContext {
        before: source_of(index.checked_sub(1)),
        after: source_of(index.checked_add(1)),
    };
    let Entry {
        slot,
        key,
        page,
        number,
        source,
        heading,
    } = entries.into_iter().nth(index).ok_or(ParagraphNotFound)?;
    Ok(LocatedParagraph {
        store,
        record,
        existed,
        slot,
        key,
        page,
        number,
        source,
        heading,
        context,
        glossary: target.options.glossary.terms().to_vec(),
        language: target.options.language,
        model: target.options.model,
    })
}

/// 범위 안 문단을 문서 순서로: 글자층 문단, 스캔 옵션이 켜졌으면 기록에 있는 스캔 쪽의 받아 적은 문단
fn document_entries(pages: &[SourcePage], include_scan_pages: bool, record: &Record) -> Vec<Entry> {
    let mut entries = Vec::new();
    for page in pages {
        match &page.content {
            SourcePageContent::Text(paragraphs) => {
                entries.extend(paragraphs.iter().map(|paragraph| Entry {
                    slot: Slot::Text,
                    key: paragraph_key(page.page, paragraph.number, &paragraph.text),
                    page: page.page,
                    number: paragraph.number,
                    source: paragraph.text.clone(),
                    heading: paragraph.heading,
                }));
            }
            SourcePageContent::Scan(_) if include_scan_pages => {
                if let Some(paragraphs) = record.scan_pages.get(&page.page) {
                    entries.extend(
                        paragraphs
                            .iter()
                            .enumerate()
                            .map(|(index, paragraph)| Entry {
                                slot: Slot::Scan {
                                    page: page.page,
                                    index,
                                },
                                key: paragraph.key.clone(),
                                page: page.page,
                                number: paragraph.number,
                                source: paragraph.source.clone(),
                                heading: false,
                            }),
                    );
                }
            }
            SourcePageContent::Scan(_) => {}
        }
    }
    entries
}

/// 직접 고친 글을 기록에 쓴다. 쓰지 못하면 그 오류다(고친 글이 남지 않는다).
pub fn edit_translated_paragraph(
    mut located: LocatedParagraph,
    text: &str,
) -> io::Result<TranslatedParagraph> {
    let edited = Some(text.trim())
        .filter(|text| !text.is_empty())
        .map(str::to_owned);
    let state = located.set_recorded(|recorded| recorded.edited = edited);
    located.save()?;
    Ok(located.paragraph(state))
}

/// 문단 하나를 앞·뒤 문맥과 함께 다시 보낸다. 기다리는 동안 취소 토큰을 본다.
pub async fn retranslate_paragraph<T: Transport>(
    mut located: LocatedParagraph,
    transport: T,
    key: ApiKey,
    cancel: &AtomicBool,
) -> Result<Retranslated, RetranslateError> {
    let item = ChunkItem {
        page: located.page,
        number: located.number,
        text: located.source.clone(),
        fragment: None,
    };
    let estimate = estimate_text_items(slice::from_ref(&item), &located.glossary, located.language);
    let chunk = TextChunk {
        items: vec![item],
        glossary: located.glossary.clone(),
        estimate,
    };
    let client = MessagesClient::new(transport, key, located.model, located.language);
    let attempt = until_cancelled(cancel, client.retranslate_text(&chunk, &located.context))
        .await
        .ok_or(RetranslateError::Cancelled)?;
    located.record.usage.add(attempt.usage);
    let outcome = match attempt.result {
        Ok(outcomes) => outcomes
            .into_iter()
            .next()
            .unwrap_or(ItemOutcome::Failed(MISSING_RESULT)),
        Err(error) => {
            located.save_quietly();
            return Err(RetranslateError::Api(error));
        }
    };
    let state = match outcome {
        ItemOutcome::Translated(target) => located.set_recorded(|recorded| {
            recorded.target = Some(target);
            recorded.edited = None;
        }),
        ItemOutcome::Failed(reason) => (None, ParagraphStatus::Failed(reason)),
        ItemOutcome::Refused => (None, ParagraphStatus::Refused),
    };
    located.save_quietly();
    Ok(Retranslated {
        paragraph: located.paragraph(state),
        usage: attempt.usage,
    })
}

impl LocatedParagraph {
    /// 기록의 그 문단을 고치고 화면 글·상태를 돌려준다. 글자층 문단이 번역도 고친 글도 없게 되면 기록에서 뺀다.
    fn set_recorded(
        &mut self,
        change: impl FnOnce(&mut RecordedParagraph),
    ) -> (Option<String>, ParagraphStatus) {
        match self.slot {
            Slot::Text => {
                let mut recorded =
                    self.record
                        .paragraphs
                        .remove(&self.key)
                        .unwrap_or(RecordedParagraph {
                            target: None,
                            edited: None,
                        });
                change(&mut recorded);
                let state = recorded_status(recorded.target.as_ref(), recorded.edited.as_ref());
                if recorded.target.is_some() || recorded.edited.is_some() {
                    self.record.paragraphs.insert(self.key.clone(), recorded);
                }
                state
            }
            Slot::Scan { page, index } => {
                let Some(paragraph) = self
                    .record
                    .scan_pages
                    .get_mut(&page)
                    .and_then(|paragraphs| paragraphs.get_mut(index))
                else {
                    return (None, ParagraphStatus::Failed(MISSING_RESULT));
                };
                let mut recorded = RecordedParagraph {
                    target: paragraph.target.take(),
                    edited: paragraph.edited.take(),
                };
                change(&mut recorded);
                paragraph.target = recorded.target;
                paragraph.edited = recorded.edited;
                recorded_status(paragraph.target.as_ref(), paragraph.edited.as_ref())
            }
        }
    }

    /// 기록을 쓴다. 문단이 하나도 없는 새 기록은 쓰지 않는다.
    fn save(&self) -> io::Result<()> {
        if self.record.is_empty() && !self.existed {
            return Ok(());
        }
        self.store.save(&self.record)
    }

    /// 다시 번역 뒤 기록 쓰기. 실패는 결과를 막지 않는다(실행기와 같다).
    fn save_quietly(&self) {
        if let Err(error) = self.save() {
            log::warn!("번역 기록을 쓰지 못했다: {}", error.kind());
        }
    }

    fn paragraph(
        &self,
        (target, status): (Option<String>, ParagraphStatus),
    ) -> TranslatedParagraph {
        TranslatedParagraph {
            key: self.key.clone(),
            number: self.number,
            source: self.source.clone(),
            target,
            heading: self.heading,
            status,
        }
    }
}
