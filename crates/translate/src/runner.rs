//! 번역 실행기(ADR 0002 §4 "이어하기", §8, §9). 이미 추출한 범위 쪽([`SourcePage`])을 받아 묶음을 차례로
//! 보내고, 묶음이 끝날 때마다 이어하기 기록을 쓰고 진행을 알린 뒤 쪽별 결과를 조립한다. pdf-core를
//! 모른다: 문단 추출·파일 해시·스캔 쪽 렌더는 `src-tauri`가 하고, 렌더는 [`ScanRenderer`]로 받는다.
//!
//! - 묶음은 늘 범위 전체로 만든다. 기록에 있는 문단은 묶음에서 빼고 보내고, 항목이 모두 기록에 있는
//!   묶음(기록에 있는 스캔 쪽)은 보내지 않고 처음부터 끝난 것으로 센다.
//! - 긴 문단의 조각은 문단 단위로만 기록한다: 조각이 모두 끝나야 그 문단이 정해지고, 조각이 모두 번역되면
//!   조각 순서대로 공백 하나로 잇고, 아니면 문서 순서로 처음 실패한 조각의 상태(실패 사유·거절)를 쓴다.
//! - 실패·거절한 문단과 스캔 쪽은 기록에 쓰지 않는다(다음 이어하기가 다시 보낸다).
//! - 취소: 묶음 사이와, 렌더·요청·재시도 대기를 기다리는 동안 본다. 기다리던 일은 버린다(요청을 끊는다).
//! - API 오류·렌더 실패는 작업을 멈춘다. 끝난 묶음은 이미 기록에 있다.

mod arrange;
mod cancel;

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::chunk::{Chunk, ChunkItem, ScanChunk, TextChunk, build_chunks};
use crate::client::{Attempt, ItemOutcome, MessagesClient, ScanOutcome};
use crate::error::ApiError;
use crate::glossary::GlossaryTerm;
use crate::http::Transport;
use crate::key::ApiKey;
use crate::progress::{
    ParagraphCounts, ProgressReporter, TranslateProgress, TranslateStage, count,
};
use crate::record::{Record, RecordStore, RecordedParagraph, RecordedScanParagraph};
use crate::record_key::{TranslationOptions, paragraph_key};
use crate::response::ScanParagraph;
use crate::source::{SourcePage, SourcePageContent};
use crate::usage::TokenUsage;

pub use arrange::{PageFailure, PageKind, ParagraphStatus, TranslatedPage, TranslatedParagraph};

/// 스캔 쪽 그림(PNG)을 보내기 직전에 만든다. 앱에서는 pdf-core `render_scan_page`(pdfium 잠금 안)이다.
pub trait ScanRenderer {
    type Error;

    fn render(&mut self, page: u32) -> impl Future<Output = Result<Vec<u8>, Self::Error>> + Send;
}

/// 번역 작업 하나
pub struct TranslationJob<'a> {
    /// 범위 안 쪽(쪽 번호 오름차순)
    pub pages: &'a [SourcePage],
    pub options: TranslationOptions<'a>,
    /// `false`면 기록을 읽지 않고 첫 쓰기에서 새 기록으로 덮는다(처음부터).
    pub resume: bool,
    /// 이어하기 기록 폴더(앱 데이터 폴더 `translations/`)
    pub record_dir: &'a Path,
}

/// 끝난 번역
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslationOutput {
    /// 기록 키(계약 `record_id`)
    pub record_key: String,
    /// 범위 안 쪽(입력 순서). 범위 밖 쪽은 담지 않는다.
    pub pages: Vec<TranslatedPage>,
    /// 기록의 누적 사용량(모든 실행)
    pub usage: TokenUsage,
    /// 범위 안 원문(스캔 쪽은 받아 적은 원문)에 원어가 나오는 용어(용어집 순서)
    pub glossary_used: Vec<GlossaryTerm>,
}

/// 작업을 멈춘 이유
#[derive(Debug, thiserror::Error)]
pub enum RunError<E> {
    /// 취소 토큰이 켜졌다(`CANCELLED`)
    #[error("CANCELLED")]
    Cancelled,
    #[error(transparent)]
    Api(ApiError),
    /// 스캔 쪽 그림을 만들지 못했다(렌더러의 오류)
    #[error("스캔 쪽 그림을 만들지 못했다")]
    Render(E),
}

/// 보낼 묶음(기록에 있는 문단을 뺀)
enum Pending<'c> {
    Text(TextChunk),
    Scan(&'c ScanChunk),
}

/// 묶음 하나를 보낸 결과
enum Sent<E> {
    Text {
        items: Vec<ChunkItem>,
        attempt: Attempt<Vec<ItemOutcome>>,
    },
    Scan {
        page: u32,
        attempt: Attempt<ScanOutcome>,
    },
    RenderFailed(E),
}

/// 범위 안 쪽을 번역한다. `reporter`로 `readDocument` 100%부터 끝까지 알린다(0%는 부르는 쪽,
/// [`ProgressReporter::read_document_started`]).
pub async fn run_translation<T, R, F>(
    job: TranslationJob<'_>,
    transport: T,
    key: ApiKey,
    renderer: &mut R,
    reporter: &mut ProgressReporter<F>,
    cancel: &AtomicBool,
) -> Result<TranslationOutput, RunError<R::Error>>
where
    T: Transport,
    R: ScanRenderer,
    F: FnMut(TranslateProgress),
{
    let options = job.options;
    let record_key = options.record_key();
    let store = RecordStore::new(job.record_dir);
    let record = job
        .resume
        .then(|| store.load(&record_key))
        .flatten()
        .unwrap_or_else(|| Record::new(&record_key));
    let mut run = Run::new(job.pages, options.include_scan_pages, record, store);
    let range_pages = count(job.pages.len());
    run.report(
        reporter,
        TranslateStage::ReadDocument,
        range_pages,
        range_pages,
    );

    let chunks = build_chunks(
        job.pages,
        options.glossary,
        options.language,
        options.include_scan_pages,
    );
    let pending: Vec<Option<Pending>> = chunks.iter().map(|chunk| run.pending(chunk)).collect();
    let total = count(chunks.len());
    let mut done = count(pending.iter().filter(|chunk| chunk.is_none()).count());
    run.report(reporter, TranslateStage::Translate, done, total);
    let client = MessagesClient::new(transport, key, options.model, options.language);
    for chunk in pending.into_iter().flatten() {
        if cancel.load(Ordering::Relaxed) {
            return Err(RunError::Cancelled);
        }
        let sent = cancel::until_cancelled(cancel, send(&client, renderer, chunk))
            .await
            .ok_or(RunError::Cancelled)?;
        run.settle(sent)?;
        done += 1;
        run.report(reporter, TranslateStage::Translate, done, total);
    }

    let (pages, glossary_used) = arrange::arrange(job.pages, &options, &run, reporter);
    Ok(TranslationOutput {
        record_key,
        pages,
        usage: run.record.usage,
        glossary_used,
    })
}

async fn send<T: Transport, R: ScanRenderer>(
    client: &MessagesClient<T>,
    renderer: &mut R,
    chunk: Pending<'_>,
) -> Sent<R::Error> {
    match chunk {
        Pending::Text(chunk) => {
            let attempt = client.translate_text(&chunk).await;
            Sent::Text {
                items: chunk.items,
                attempt,
            }
        }
        Pending::Scan(chunk) => match renderer.render(chunk.page).await {
            Ok(png) => Sent::Scan {
                page: chunk.page,
                attempt: client.translate_scan(chunk, &png).await,
            },
            Err(error) => Sent::RenderFailed(error),
        },
    }
}

/// 실행 하나의 상태
struct Run {
    include_scan_pages: bool,
    /// (쪽, 문단 번호) → 문단 키(범위 안 글자층 문단)
    keys: HashMap<(u32, u32), String>,
    record: Record,
    store: RecordStore,
    /// 이번 실행에서 받은 200 응답의 합
    usage: TokenUsage,
    /// 이번 실행에서 실패·거절로 정해진 문단(기록에 쓰지 않는다)
    unsettled: HashMap<String, ParagraphStatus>,
    /// 이번 실행에서 실패·거절한 스캔 쪽
    scan_failures: HashMap<u32, PageFailure>,
    /// 조각 일부만 끝난 문단의 조각 결과(조각 순서)
    fragments: HashMap<String, Vec<ItemOutcome>>,
    counts: ParagraphCounts,
}

impl Run {
    fn new(
        pages: &[SourcePage],
        include_scan_pages: bool,
        record: Record,
        store: RecordStore,
    ) -> Self {
        let mut keys = HashMap::new();
        let mut counts = ParagraphCounts::default();
        for page in pages {
            match &page.content {
                SourcePageContent::Text(paragraphs) => {
                    for paragraph in paragraphs {
                        let key = paragraph_key(page.page, paragraph.number, &paragraph.text);
                        counts.count += 1;
                        if record.paragraphs.contains_key(&key) {
                            counts.done += 1;
                        }
                        keys.insert((page.page, paragraph.number), key);
                    }
                }
                SourcePageContent::Scan(_) if include_scan_pages => {
                    if let Some(paragraphs) = record.scan_pages.get(&page.page) {
                        counts.count += count(paragraphs.len());
                        counts.done += count(paragraphs.len());
                    }
                }
                SourcePageContent::Scan(_) => {}
            }
        }
        Self {
            include_scan_pages,
            keys,
            record,
            store,
            usage: TokenUsage::default(),
            unsettled: HashMap::new(),
            scan_failures: HashMap::new(),
            fragments: HashMap::new(),
            counts,
        }
    }

    fn report<F: FnMut(TranslateProgress)>(
        &self,
        reporter: &mut ProgressReporter<F>,
        stage: TranslateStage,
        done: u32,
        total: u32,
    ) {
        reporter.report(stage, done, total, self.counts, self.usage);
    }

    fn key(&self, item: &ChunkItem) -> Option<&String> {
        self.keys.get(&(item.page, item.number))
    }

    /// 묶음에서 기록에 있는 것을 뺀 보낼 묶음. 남은 것이 없으면 `None`(끝난 묶음)이다. 남은 항목만 담은
    /// 텍스트 묶음은 용어집·예상치를 그대로 쓴다(나눈 요청처럼 보낼 때 그 항목에 나오는 용어만 싣는다).
    fn pending<'c>(&self, chunk: &'c Chunk) -> Option<Pending<'c>> {
        match chunk {
            Chunk::Text(chunk) => {
                let items: Vec<ChunkItem> = chunk
                    .items
                    .iter()
                    .filter(|item| {
                        self.key(item)
                            .is_none_or(|key| !self.record.paragraphs.contains_key(key))
                    })
                    .cloned()
                    .collect();
                (!items.is_empty()).then(|| {
                    Pending::Text(TextChunk {
                        items,
                        glossary: chunk.glossary.clone(),
                        estimate: chunk.estimate,
                    })
                })
            }
            Chunk::Scan(chunk) => {
                (!self.record.scan_pages.contains_key(&chunk.page)).then_some(Pending::Scan(chunk))
            }
        }
    }

    /// 보낸 묶음의 결과를 상태·기록에 담고 기록을 쓴다. 작업을 멈추는 오류면 그 오류다(사용량은 더한다).
    fn settle<E>(&mut self, sent: Sent<E>) -> Result<(), RunError<E>> {
        match sent {
            Sent::RenderFailed(error) => return Err(RunError::Render(error)),
            Sent::Text { items, attempt } => {
                self.add_usage(attempt.usage);
                let outcomes = attempt.result.map_err(RunError::Api)?;
                for (item, outcome) in items.iter().zip(outcomes) {
                    self.settle_item(item, outcome);
                }
            }
            Sent::Scan { page, attempt } => {
                self.add_usage(attempt.usage);
                match attempt.result.map_err(RunError::Api)? {
                    ScanOutcome::Paragraphs(paragraphs) => self.settle_scan_page(page, paragraphs),
                    ScanOutcome::Failed(reason) => {
                        self.scan_failures.insert(page, PageFailure::Failed(reason));
                    }
                    ScanOutcome::Refused => {
                        self.scan_failures.insert(page, PageFailure::Refused);
                    }
                }
            }
        }
        self.write_record();
        Ok(())
    }

    fn add_usage(&mut self, usage: TokenUsage) {
        self.usage.add(usage);
        self.record.usage.add(usage);
    }

    fn settle_item(&mut self, item: &ChunkItem, outcome: ItemOutcome) {
        // 묶음은 같은 쪽 목록으로 만들어 항목의 문단 키는 늘 있다.
        let Some(key) = self.key(item).cloned() else {
            return;
        };
        let outcome = match item.fragment {
            None => outcome,
            Some(fragment) => {
                let parts = self.fragments.entry(key.clone()).or_default();
                parts.push(outcome);
                if fragment.index + 1 < fragment.count {
                    return;
                }
                join_fragments(self.fragments.remove(&key).unwrap_or_default())
            }
        };
        self.counts.done += 1;
        match outcome {
            ItemOutcome::Translated(target) => {
                self.record.paragraphs.insert(
                    key,
                    RecordedParagraph {
                        target: Some(target),
                        edited: None,
                    },
                );
            }
            ItemOutcome::Failed(reason) => {
                self.unsettled.insert(key, ParagraphStatus::Failed(reason));
            }
            ItemOutcome::Refused => {
                self.unsettled.insert(key, ParagraphStatus::Refused);
            }
        }
    }

    fn settle_scan_page(&mut self, page: u32, paragraphs: Vec<ScanParagraph>) {
        let recorded: Vec<RecordedScanParagraph> = paragraphs
            .into_iter()
            .zip(1..)
            .map(|(paragraph, number)| RecordedScanParagraph {
                key: paragraph_key(page, number, &paragraph.source),
                number,
                source: paragraph.source,
                target: Some(paragraph.text),
                edited: None,
            })
            .collect();
        self.counts.count += count(recorded.len());
        self.counts.done += count(recorded.len());
        self.record.scan_pages.insert(page, recorded);
    }

    /// 담은 것이 있으면 기록을 쓴다. 실패는 작업을 멈추지 않는다(결과는 화면에 있고 다음 실행이 다시 보낸다).
    fn write_record(&self) {
        if self.record.is_empty() {
            return;
        }
        if let Err(error) = self.store.save(&self.record) {
            log::warn!("번역 기록을 쓰지 못했다: {}", error.kind());
        }
    }
}

/// 조각 결과를 문단 하나로: 모두 번역이면 조각 순서대로 공백 하나로 잇고, 아니면 처음 실패한 조각의 상태다.
fn join_fragments(parts: Vec<ItemOutcome>) -> ItemOutcome {
    let mut texts = Vec::with_capacity(parts.len());
    for part in parts {
        match part {
            ItemOutcome::Translated(text) => texts.push(text),
            failed => return failed,
        }
    }
    ItemOutcome::Translated(texts.join(" "))
}
