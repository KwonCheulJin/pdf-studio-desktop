//! 비교 작업 실행기(계획서 §6.2 6번). 두 PDF를 읽어 [`CompareResult`]를 만들고 6단계 진행률을 보낸다.
//! 규칙의 정본은 ADR 0001 §15다.
//!
//! - 순서: 쪽 범위 검사(오류면 아무 단계도 시작하지 않는다) → A 추출 → B 추출 → OCR(두 문서 비교 범위
//!   안의 OCR 대상 쪽) → 글자 정리(쪽 범위 선택 → 줄 제외 → 토큰화, ADR §13) → diff → 쪽 짝짓기.
//! - 추출 결과(문서 전체 텍스트 레이어 + OCR에 성공한 쪽)는 메모리 캐시([`ExtractionCache`])에 둔다.
//!   옵션만 바꾼 재실행에서는 추출·OCR을 하지 않고 그 단계를 바로 100%로 알린다. OCR 결과는 디스크
//!   캐시([`OcrCache`])에도 쓴다.
//! - 취소는 단계를 시작할 때마다, 추출·OCR은 쪽마다 확인한다.

mod cache;
mod progress;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use pdfium_render::prelude::{PdfDocument, Pdfium};

use self::cache::{FileKey, ReadText};
use self::progress::ProgressReporter;
use super::diff::{DIFF_TIME_LIMIT, diff_tokens_with_progress};
use super::extract::{ExtractedChar, ExtractedPage, extract_pages};
use super::model::{
    CompareResult, NoTextReason, PageSize, PageSizes, PageSources, Side, TextSource,
};
use super::ocr_text::ocr_chars;
use super::options::{CompareOptions, LineExclusions, exclude_lines};
use super::pages::pair_pages;
use super::pipeline::{
    CompareError, OcrFailure, ensure_not_cancelled, ordered_notices, recognize_and_store,
    tokenize_pair,
};
use super::tokenize::has_low_text_confidence;
use crate::document::open_document;
use crate::engine::PdfEngine;
use crate::ocr::{FileDigest, OcrCache, OcrEngine};

pub use self::cache::ExtractionCache;
pub use self::progress::{CompareProgress, CompareStage, ProgressDetail};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompareRequest {
    /// 진행 이벤트에 그대로 싣는 작업 ID(프론트가 만든다)
    pub job_id: String,
    /// A(이전, 왼쪽) 문서
    pub before: PathBuf,
    /// B(이후, 오른쪽) 문서
    pub after: PathBuf,
    pub options: CompareOptions,
}

/// 두 PDF를 옵션대로 비교한다.
///
/// - `ocr`는 호출자가 한 번 로드한 OCR 엔진이다. 없으면(런타임·모델 없음) OCR 대상 쪽은
///   `NoTextLayer`(`OcrUnavailable`)로 알리고 텍스트 레이어 글자로 비교한다. `ocr_cache`는 앱 캐시
///   폴더의 OCR 디스크 캐시, `extraction_cache`는 앱이 하나 두고 비교마다 넘기는 메모리 캐시다.
/// - 쪽 범위가 잘못되면 아무 단계도 시작하지 않고 [`CompareError::Options`]다.
/// - `cancel`은 단계마다, 추출·OCR은 쪽마다 확인하고 켜져 있으면 [`CompareError::Cancelled`]다.
///   렌더 이미지는 메모리에만 있어 남는 파일이 없다.
/// - 원본 파일은 읽기만 한다.
pub fn compare_pdfs(
    engine: &PdfEngine,
    request: &CompareRequest,
    ocr: Option<&mut OcrEngine>,
    ocr_cache: Option<&OcrCache>,
    extraction_cache: &ExtractionCache,
    cancel: &AtomicBool,
    on_progress: impl FnMut(CompareProgress),
) -> Result<CompareResult, CompareError> {
    let context = Context {
        pdfium: engine.pdfium(),
        ocr_cache,
        extraction_cache,
        cancel,
    };
    let mut reporter = ProgressReporter::new(&request.job_id, on_progress);
    ensure_not_cancelled(cancel)?;

    let options = &request.options;
    let before = Input::open(&context, &request.before)?;
    let after = Input::open(&context, &request.after)?;
    let before_range = options.range_pages(Side::Before, before.page_count())?;
    let after_range = options.range_pages(Side::After, after.page_count())?;

    let mut before = before.extract(
        &context,
        CompareStage::ExtractA,
        before_range,
        &mut reporter,
    )?;
    let mut after = after.extract(&context, CompareStage::ExtractB, after_range, &mut reporter)?;
    read_scanned_pages(&context, ocr, [&mut before, &mut after], &mut reporter)?;

    ensure_not_cancelled(cancel)?;
    let range_total = before.range.len() + after.range.len();
    reporter.report(CompareStage::Normalize, 0, range_total);
    let exclusions = options.exclusions();
    let [before_tokens, after_tokens] = tokenize_pair(
        [
            (&before.range_pages(exclusions), &before.range_sources()),
            (&after.range_pages(exclusions), &after.range_sources()),
        ],
        options.normalize_options(),
        |done| reporter.report(CompareStage::Normalize, done, range_total),
    );

    ensure_not_cancelled(cancel)?;
    let diff = diff_tokens_with_progress(
        &before_tokens,
        &after_tokens,
        DIFF_TIME_LIMIT,
        |done, total| reporter.report(CompareStage::Diff, done, total),
    );

    ensure_not_cancelled(cancel)?;
    reporter.report(CompareStage::AlignPages, 0, range_total);
    let page_pairs = pair_pages(
        &before.range,
        &after.range,
        &before_tokens,
        &after_tokens,
        &diff.matches,
    );
    let result = CompareResult {
        changes: diff.changes,
        page_pairs,
        page_sizes: PageSizes {
            before: before.sizes(),
            after: after.sizes(),
        },
        page_sources: PageSources {
            before: before.sources(),
            after: after.sources(),
        },
        notices: ordered_notices(
            [before.low_confidence_pages(), after.low_confidence_pages()],
            [&before.ocr_failures, &after.ocr_failures],
            diff.truncated,
        ),
    };
    reporter.report(CompareStage::AlignPages, range_total, range_total);
    Ok(result)
}

/// 단계 함수들이 함께 쓰는 실행 환경
struct Context<'a> {
    pdfium: &'a Pdfium,
    ocr_cache: Option<&'a OcrCache>,
    extraction_cache: &'a ExtractionCache,
    cancel: &'a AtomicBool,
}

/// 비교 시작 때 연 문서 하나
struct Input<'a> {
    path: &'a Path,
    key: Option<FileKey>,
    loaded: Loaded<'a>,
}

enum Loaded<'a> {
    /// 추출 캐시에 있던 글자
    Cached(Arc<ReadText>),
    /// 캐시에 없어 연 문서. 추출 단계에서 읽는다.
    Opened(Box<PdfDocument<'a>>),
}

impl<'a> Input<'a> {
    fn open(context: &Context<'a>, path: &'a Path) -> Result<Self, CompareError> {
        let key = FileKey::of(path);
        let cached = key
            .as_ref()
            .and_then(|key| context.extraction_cache.get(key));
        let loaded = match cached {
            Some(text) => Loaded::Cached(text),
            None => Loaded::Opened(Box::new(open_document(context.pdfium, path)?)),
        };
        Ok(Self { path, key, loaded })
    }

    fn page_count(&self) -> u32 {
        match &self.loaded {
            Loaded::Cached(text) => u32::try_from(text.pages.len()).unwrap_or(u32::MAX),
            // pdfium 쪽 수는 음수가 아니다.
            Loaded::Opened(document) => u32::try_from(document.pages().len()).unwrap_or_default(),
        }
    }

    /// 텍스트 레이어를 쪽마다 읽어 추출 캐시에 둔다. 캐시에 있던 문서는 읽지 않고 100%를 알린다.
    fn extract(
        self,
        context: &Context<'a>,
        stage: CompareStage,
        range: Vec<u32>,
        reporter: &mut ProgressReporter<'_, impl FnMut(CompareProgress)>,
    ) -> Result<Document<'a>, CompareError> {
        ensure_not_cancelled(context.cancel)?;
        let (text, document) = match self.loaded {
            Loaded::Cached(text) => {
                reporter.report_cached(stage, text.pages.len());
                (text, None)
            }
            Loaded::Opened(document) => {
                let total = usize::try_from(document.pages().len()).unwrap_or_default();
                reporter.report(stage, 0, total);
                let mut pages = Vec::with_capacity(total);
                for page in extract_pages(&document, self.path) {
                    pages.push(page?);
                    reporter.report(stage, pages.len(), total);
                    // 다음 쪽을 읽기 전에 확인한다(마지막 쪽 뒤의 확인은 다음 단계 시작 때와 같다).
                    ensure_not_cancelled(context.cancel)?;
                }
                let text = Arc::new(ReadText::new(pages));
                if let Some(key) = &self.key {
                    context.extraction_cache.put(key.clone(), Arc::clone(&text));
                }
                (text, Some(*document))
            }
        };
        Ok(Document {
            path: self.path,
            key: self.key,
            text,
            document,
            range,
            ocr_failures: Vec::new(),
        })
    }
}

/// 추출을 마친 문서 하나
struct Document<'a> {
    path: &'a Path,
    key: Option<FileKey>,
    text: Arc<ReadText>,
    /// 추출하느라 연 문서. 캐시에서 글자를 얻었으면 OCR할 쪽이 생길 때 연다.
    document: Option<PdfDocument<'a>>,
    /// 비교 범위(0부터 센 쪽 번호, 오름차순, 중복 없음)
    range: Vec<u32>,
    /// 이번 실행에서 OCR로 글자를 얻지 못한 범위 안 쪽(쪽 번호 오름차순)
    ocr_failures: Vec<OcrFailure>,
}

impl<'a> Document<'a> {
    fn page(&self, page: u32) -> Option<&ExtractedPage> {
        self.text.pages.get(page as usize)
    }

    /// 비교 범위 안의 OCR 대상 쪽(텍스트 레이어 글자가 `OCR_MIN_TEXT_CHARS`보다 적은 쪽)
    fn ocr_targets(&self) -> impl Iterator<Item = u32> + '_ {
        self.range
            .iter()
            .copied()
            .filter(|&page| self.page(page).is_some_and(|extracted| extracted.needs_ocr))
    }

    /// OCR 글자가 있다(이번 실행이나 앞선 실행에서 OCR에 성공했다).
    fn has_ocr(&self, page: u32) -> bool {
        self.text
            .ocr
            .get(page as usize)
            .is_some_and(Option::is_some)
    }

    fn opened(&mut self, pdfium: &'a Pdfium) -> Result<&PdfDocument<'a>, CompareError> {
        Ok(match &mut self.document {
            Some(document) => document,
            slot @ None => slot.insert(open_document(pdfium, self.path)?),
        })
    }

    /// 새로 얻은 OCR 글자를 담고 추출 캐시를 바꾼다.
    fn remember_ocr(&mut self, found: Vec<(u32, Vec<ExtractedChar>)>, cache: &ExtractionCache) {
        if found.is_empty() {
            return;
        }
        let text = Arc::make_mut(&mut self.text);
        for (page, chars) in found {
            if let Some(slot) = text.ocr.get_mut(page as usize) {
                *slot = Some(chars);
            }
        }
        if let Some(key) = &self.key {
            cache.put(key.clone(), Arc::clone(&self.text));
        }
    }

    /// 비교 범위의 쪽(범위 순서). OCR한 쪽은 OCR 글자로 바꾸고, 줄 제외를 적용한다.
    fn range_pages(&self, exclusions: LineExclusions) -> Vec<ExtractedPage> {
        self.range
            .iter()
            .filter_map(|&page| {
                let extracted = self.page(page)?;
                Some(match self.text.ocr.get(page as usize) {
                    Some(Some(chars)) => exclude_lines(
                        &ExtractedPage {
                            size: extracted.size,
                            chars: chars.clone(),
                            needs_ocr: extracted.needs_ocr,
                        },
                        exclusions,
                    ),
                    _ => exclude_lines(extracted, exclusions),
                })
            })
            .collect()
    }

    fn sizes(&self) -> Vec<PageSize> {
        self.text.pages.iter().map(|page| page.size).collect()
    }

    /// diff에 넣는 글자의 출처(OCR에 성공했으면 `Ocr`)
    fn source(&self, page: u32) -> TextSource {
        if self.has_ocr(page) {
            TextSource::Ocr
        } else {
            TextSource::TextLayer
        }
    }

    /// 비교 범위 쪽마다의 출처(범위 순서)
    fn range_sources(&self) -> Vec<TextSource> {
        self.range.iter().map(|&page| self.source(page)).collect()
    }

    /// 문서의 모든 쪽. 비교 범위 밖 쪽은 `None`이다.
    fn sources(&self) -> Vec<Option<TextSource>> {
        let mut sources = vec![None; self.text.pages.len()];
        for &page in &self.range {
            if let Some(source) = sources.get_mut(page as usize) {
                *source = Some(self.source(page));
            }
        }
        sources
    }

    /// `LowTextConfidence`를 붙일 쪽: 범위 안에서 출처가 텍스트 레이어이고 대체 문자·PUA 비율이 높은 쪽
    /// (줄 제외 전 글자로 판정한다)
    fn low_confidence_pages(&self) -> Vec<u32> {
        self.range
            .iter()
            .copied()
            .filter(|&page| {
                !self.has_ocr(page) && self.page(page).is_some_and(has_low_text_confidence)
            })
            .collect()
    }
}

/// OCR 단계: 두 문서 비교 범위 안의 OCR 대상 쪽을 추출 캐시 → OCR 디스크 캐시 → OCR 순서로 채운다.
/// 렌더·인식할 쪽이 없으면(대상 쪽이 없거나 모두 캐시에 있거나 OCR 엔진이 없다) 100% 하나만 알린다.
fn read_scanned_pages<'a>(
    context: &Context<'a>,
    mut ocr: Option<&mut OcrEngine>,
    documents: [&mut Document<'a>; 2],
    reporter: &mut ProgressReporter<'_, impl FnMut(CompareProgress)>,
) -> Result<(), CompareError> {
    ensure_not_cancelled(context.cancel)?;
    let total: usize = documents
        .iter()
        .map(|document| document.ocr_targets().count())
        .sum();
    let mut from_cache = 0;
    let mut found: [Vec<(u32, Vec<ExtractedChar>)>; 2] = Default::default();
    let mut digests: [Option<FileDigest>; 2] = [None, None];
    let mut pending: Vec<(usize, u32)> = Vec::new();
    for (index, document) in documents.iter().enumerate() {
        let missing: Vec<u32> = document
            .ocr_targets()
            .filter(|&page| !document.has_ocr(page))
            .collect();
        from_cache += document.ocr_targets().count() - missing.len();
        // 파일 해시는 OCR 디스크 캐시를 볼 쪽이 있을 때만 센다(큰 스캔 파일은 수백 ms).
        digests[index] = context
            .ocr_cache
            .filter(|_| !missing.is_empty())
            .and_then(|_| FileDigest::of_file(document.path).ok());
        for page in missing {
            let cached = context
                .ocr_cache
                .zip(digests[index])
                .and_then(|(cache, digest)| cache.get(digest, page));
            match (cached, document.page(page)) {
                (Some(cached), Some(extracted)) => {
                    found[index].push((page, ocr_chars(&cached, page, &extracted.size)));
                    from_cache += 1;
                }
                _ => pending.push((index, page)),
            }
        }
    }

    let mut done = total - pending.len();
    if ocr.is_none() || pending.is_empty() {
        for (index, page) in pending {
            documents[index].ocr_failures.push(OcrFailure {
                page,
                reason: NoTextReason::OcrUnavailable,
            });
        }
        if total > 0 && from_cache == total {
            reporter.report_cached(CompareStage::Ocr, total);
        } else {
            reporter.report(CompareStage::Ocr, total, total);
        }
    } else {
        reporter.report(CompareStage::Ocr, done, total);
        let mut wrote_cache = false;
        for (index, page) in pending {
            ensure_not_cancelled(context.cancel)?;
            let document = &mut *documents[index];
            let (path, cache) = (document.path, context.ocr_cache.zip(digests[index]));
            let size = document.page(page).map(|extracted| extracted.size);
            let result = match (ocr.as_deref_mut(), size) {
                (Some(ocr), Some(size)) => recognize_and_store(
                    document.opened(context.pdfium)?,
                    path,
                    page,
                    ocr,
                    cache,
                    context.cancel,
                )?
                .map(|recognized| ocr_chars(&recognized, page, &size)),
                _ => Err(NoTextReason::OcrUnavailable),
            };
            match result {
                Ok(chars) => {
                    wrote_cache |= cache.is_some();
                    found[index].push((page, chars));
                }
                Err(reason) => document.ocr_failures.push(OcrFailure { page, reason }),
            }
            done += 1;
            reporter.report(CompareStage::Ocr, done, total);
        }
        if wrote_cache && let Some(cache) = context.ocr_cache {
            cache.trim();
        }
    }
    for (document, found) in documents.into_iter().zip(found) {
        document.remember_ocr(found, context.extraction_cache);
    }
    Ok(())
}
