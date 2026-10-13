//! 비교 파이프라인 조립(계획서 §6.2·§6.4): 문서마다 글자 읽기(텍스트 레이어 추출 + OCR 대상 쪽
//! OCR) → 두 문서 토큰화 → diff. 규칙의 정본은 ADR 0001 §5·§6·§11이다.
//!
//! - 쪽 짝짓기(§12)·옵션(§13)·진행률은 여기서 잇지 않는다. 그것까지 한 번에 하는 것은 실행기
//!   (`runner.rs`, §15)이고, 실행기는 여기 조각(NFKC 강제, 안내 정렬, 쪽 인식)을 함께 쓴다. 이 파일의
//!   공개 함수는 비교 범위가 문서 전체다.
//! - 취소는 쪽마다(OCR 렌더 뒤, 추론 뒤) 확인한다. 렌더 이미지는 메모리에만 있어 남는 파일이 없다.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use pdfium_render::prelude::PdfDocument;

use super::diff::diff_tokens;
use super::extract::{ExtractedPage, extract_text_layer};
use super::model::{Change, NoTextReason, Notice, PageSizes, PageSources, Side, TextSource};
use super::ocr_text::ocr_chars;
use super::options::CompareOptionsError;
use super::tokenize::{
    NormalizeOptions, Token, UnicodeForm, has_low_text_confidence, tokenize_pages,
};
use crate::document::{DocumentError, open_document};
use crate::engine::PdfEngine;
use crate::ocr::{FileDigest, OcrCache, OcrEngine, OcrPage, render_page};

#[derive(Debug, thiserror::Error)]
pub enum CompareError {
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// 쪽 범위가 잘못됐다. 실행기는 비교 시작 때 검사하므로 아무 단계도 하지 않은 채 끝난다.
    #[error(transparent)]
    Options(#[from] CompareOptionsError),
    #[error("comparison was cancelled")]
    Cancelled,
}

/// OCR 대상인데 OCR로 글자를 얻지 못한 쪽. 그 쪽은 텍스트 레이어 글자로 비교한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OcrFailure {
    pub page: u32,
    pub reason: NoTextReason,
}

/// 비교에 넣을 한 문서의 글자
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentText {
    /// 색인 = 쪽 번호. OCR한 쪽의 `chars`는 OCR 글자다.
    pub pages: Vec<ExtractedPage>,
    /// 쪽마다 `chars`의 출처(색인 = 쪽 번호)
    pub sources: Vec<TextSource>,
    /// 쪽 번호 오름차순
    pub ocr_failures: Vec<OcrFailure>,
}

/// 두 문서의 비교 결과 중 페이지 짝짓기(Step 20) 전까지 정해지는 부분
#[derive(Debug, Clone, PartialEq)]
pub struct TextComparison {
    pub changes: Vec<Change>,
    pub page_sizes: PageSizes,
    pub page_sources: PageSources,
    /// ADR 0001 §6 순서(종류 → `side` → `reason`)
    pub notices: Vec<Notice>,
}

/// 문서의 글자를 읽는다. OCR 대상 쪽(`needs_ocr`)은 캐시에 있으면 그 결과를, 없으면 `ocr`로 렌더·
/// 인식한 결과(캐시에 저장)를 쓴다. `ocr`가 없으면(런타임·모델 없음) `OcrUnavailable`, 그 쪽의
/// 렌더·추론이 실패하면 `OcrFailed`로 남기고 텍스트 레이어 글자를 둔다. 캐시만 있으면 `ocr` 없이도
/// OCR 결과를 쓴다.
pub fn read_document_text(
    engine: &PdfEngine,
    path: &Path,
    mut ocr: Option<&mut OcrEngine>,
    cache: Option<&OcrCache>,
    cancel: &AtomicBool,
) -> Result<DocumentText, CompareError> {
    let mut pages = extract_text_layer(engine, path)?;
    let mut sources = vec![TextSource::TextLayer; pages.len()];
    let mut ocr_failures = Vec::new();
    let targets: Vec<u32> = (0_u32..)
        .zip(&pages)
        .filter(|(_, page)| page.needs_ocr)
        .map(|(page_number, _)| page_number)
        .collect();
    if targets.is_empty() {
        return Ok(DocumentText {
            pages,
            sources,
            ocr_failures,
        });
    }

    // 파일을 읽지 못하면 캐시 없이 계속한다(문서는 이미 열었다).
    let cache = cache.and_then(|cache| Some((cache, FileDigest::of_file(path).ok()?)));
    let document = match ocr {
        Some(_) => Some(open_document(engine.pdfium(), path)?),
        None => None,
    };
    let mut wrote_cache = false;
    for page_number in targets {
        ensure_not_cancelled(cancel)?;
        let cached = cache.and_then(|(cache, digest)| cache.get(digest, page_number));
        let result = match (cached, ocr.as_deref_mut(), &document) {
            (Some(cached), _, _) => Ok(cached),
            (None, Some(ocr), Some(document)) => {
                let result = recognize_and_store(document, path, page_number, ocr, cache, cancel)?;
                wrote_cache |= result.is_ok() && cache.is_some();
                result
            }
            _ => Err(NoTextReason::OcrUnavailable),
        };
        let index = page_number as usize;
        match result {
            Ok(page) => {
                pages[index].chars = ocr_chars(&page, page_number, &pages[index].size);
                sources[index] = TextSource::Ocr;
            }
            Err(reason) => ocr_failures.push(OcrFailure {
                page: page_number,
                reason,
            }),
        }
    }
    if wrote_cache && let Some((cache, _)) = cache {
        cache.trim();
    }
    Ok(DocumentText {
        pages,
        sources,
        ocr_failures,
    })
}

/// 쪽 하나를 렌더·인식하고, 성공하면 `cache`(파일 해시와 함께)에 쓴다. 취소는 `Err`, 렌더·추론
/// 실패는 `Ok(Err(OcrFailed))`다.
pub(super) fn recognize_and_store(
    document: &PdfDocument,
    path: &Path,
    page_number: u32,
    ocr: &mut OcrEngine,
    cache: Option<(&OcrCache, FileDigest)>,
    cancel: &AtomicBool,
) -> Result<Result<OcrPage, NoTextReason>, CompareError> {
    let result = recognize_page(document, path, page_number, ocr, cancel)?;
    if let (Ok(page), Some((cache, digest))) = (&result, cache) {
        cache.put(digest, page_number, page);
    }
    Ok(result)
}

/// 쪽 하나를 렌더하고 인식한다. 취소는 `Err`, 렌더·추론 실패는 `Ok(Err(OcrFailed))`다.
fn recognize_page(
    document: &PdfDocument,
    path: &Path,
    page_number: u32,
    ocr: &mut OcrEngine,
    cancel: &AtomicBool,
) -> Result<Result<OcrPage, NoTextReason>, CompareError> {
    let image = i32::try_from(page_number)
        .ok()
        .and_then(|index| document.pages().get(index).ok())
        .and_then(|page| render_page(&page, path).ok());
    ensure_not_cancelled(cancel)?;
    let Some(image) = image else {
        return Ok(Err(NoTextReason::OcrFailed));
    };
    let lines = ocr.recognize(&image);
    ensure_not_cancelled(cancel)?;
    Ok(lines
        .map(|lines| OcrPage {
            width: image.width(),
            height: image.height(),
            lines,
        })
        .map_err(|_| NoTextReason::OcrFailed))
}

pub(super) fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<(), CompareError> {
    if cancel.load(Ordering::Relaxed) {
        Err(CompareError::Cancelled)
    } else {
        Ok(())
    }
}

/// 두 문서를 토큰화해 비교한다. `options`는 사용자 옵션에서 나온 값(`CompareOptions::normalize_options`)
/// 이고, 어느 쪽에든 OCR 쪽이 있으면 형식만 NFKC로 올린다(ADR 0001 §5: OCR은 원문자·전각 문자를
/// 일반 문자로 읽는다). 쪽 범위·줄 제외(§13)와 쪽 짝짓기(§12)는 여기서 하지 않는다(Step 22 실행기가 잇는다).
pub fn compare_texts(
    before: &DocumentText,
    after: &DocumentText,
    options: NormalizeOptions,
    time_limit: Duration,
) -> TextComparison {
    let [before_tokens, after_tokens] = tokenize_pair(
        [
            (&before.pages, &before.sources),
            (&after.pages, &after.sources),
        ],
        options,
        |_| {},
    );
    let diff = diff_tokens(&before_tokens, &after_tokens, time_limit);

    let low_confidence = [before, after].map(|document| {
        (0_u32..)
            .zip(document.pages.iter().zip(&document.sources))
            .filter(|(_, (page, source))| {
                **source == TextSource::TextLayer && has_low_text_confidence(page)
            })
            .map(|(page_number, _)| page_number)
            .collect()
    });
    let notices = ordered_notices(
        low_confidence,
        [&before.ocr_failures, &after.ocr_failures],
        diff.truncated,
    );

    let sizes = |document: &DocumentText| document.pages.iter().map(|page| page.size).collect();
    let sources = |document: &DocumentText| document.sources.iter().copied().map(Some).collect();
    TextComparison {
        changes: diff.changes,
        page_sizes: PageSizes {
            before: sizes(before),
            after: sizes(after),
        },
        page_sources: PageSources {
            before: sources(before),
            after: sources(after),
        },
        notices,
    }
}

/// 두 문서(`[A, B]`, 쪽들과 쪽마다의 출처)를 토큰화한다. `options`는 사용자 옵션에서 나온 값이고,
/// 어느 쪽에든 출처가 OCR인 쪽이 있으면 두 문서 모두 형식만 NFKC로 올린다(ADR 0001 §5: OCR은
/// 원문자·전각 문자를 일반 문자로 읽는다). 쪽마다 `on_page(A·B를 이어 센 끝낸 쪽 수)`를 부른다.
pub(super) fn tokenize_pair(
    documents: [(&[ExtractedPage], &[TextSource]); 2],
    options: NormalizeOptions,
    mut on_page: impl FnMut(usize),
) -> [Vec<Token>; 2] {
    let has_ocr = documents
        .iter()
        .any(|(_, sources)| sources.contains(&TextSource::Ocr));
    let options = if has_ocr {
        NormalizeOptions {
            form: UnicodeForm::Nfkc,
            ..options
        }
    } else {
        options
    };
    let [(before, _), (after, _)] = documents;
    let before_tokens = tokenize_pages(before, options, &mut on_page);
    let after_tokens = tokenize_pages(after, options, |done| on_page(before.len() + done));
    [before_tokens, after_tokens]
}

/// ADR 0001 §6 순서(종류 → `side` → `reason`)의 안내. 배열은 `[A, B]`이고, `low_confidence`는
/// `LowTextConfidence`를 붙일 쪽(오름차순), `ocr_failures`는 쪽 번호 오름차순이다.
pub(super) fn ordered_notices(
    low_confidence: [Vec<u32>; 2],
    ocr_failures: [&[OcrFailure]; 2],
    truncated: Option<Notice>,
) -> Vec<Notice> {
    const SIDES: [Side; 2] = [Side::Before, Side::After];
    let mut notices: Vec<Notice> = SIDES
        .into_iter()
        .zip(low_confidence)
        .filter(|(_, pages)| !pages.is_empty())
        .map(|(side, pages)| Notice::LowTextConfidence { side, pages })
        .collect();
    for (side, failures) in SIDES.into_iter().zip(ocr_failures) {
        for reason in [NoTextReason::OcrUnavailable, NoTextReason::OcrFailed] {
            let pages: Vec<u32> = failures
                .iter()
                .filter(|failure| failure.reason == reason)
                .map(|failure| failure.page)
                .collect();
            if !pages.is_empty() {
                notices.push(Notice::NoTextLayer {
                    side,
                    reason,
                    pages,
                });
            }
        }
    }
    notices.extend(truncated);
    notices
}
