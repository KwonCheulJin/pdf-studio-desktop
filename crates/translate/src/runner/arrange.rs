//! 쪽별 결과 조립(ADR 0002 §9 `arrange`, §10 `TranslatedPage`). 문단 상태는 기록(번역·직접 고친 글)과
//! 이번 실행의 실패·거절에서 온다. 범위 밖 쪽(`OutOfRange`)은 문서 쪽 수를 아는 `src-tauri`가 채운다.

use std::collections::BTreeSet;

use crate::client::FailReason;
use crate::glossary::{Glossary, GlossaryTerm};
use crate::progress::{ProgressReporter, TranslateProgress, TranslateStage, count};
use crate::record::RecordedParagraph;
use crate::record_key::TranslationOptions;
use crate::source::{SourcePage, SourcePageContent, SourceParagraph};

use super::Run;

/// 쪽 하나의 결과
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslatedPage {
    /// 0부터
    pub page: u32,
    pub kind: PageKind,
    pub paragraphs: Vec<TranslatedParagraph>,
    /// 스캔 쪽 자체가 실패했다(`Image`일 때만, 문단 없음)
    pub failure: Option<PageFailure>,
}

/// 쪽 종류(계약 `PageKind`에서 `OutOfRange`를 뺀 것)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageKind {
    TextLayer,
    /// 스캔 쪽 + 옵션 켬(받아 적은 문단)
    Image,
    /// 스캔 쪽 + 옵션 끔(문단 없음)
    ScanSkipped,
}

/// 스캔 쪽 실패(계약 `TranslatedPage.failCode`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageFailure {
    Failed(FailReason),
    Refused,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslatedParagraph {
    /// 문단 키(ADR 0002 §3)
    pub key: String,
    /// 쪽 안 순번, 1부터
    pub number: u32,
    pub source: String,
    /// 화면에 보일 글(직접 고친 글 우선). 실패·거절이면 없다.
    pub target: Option<String>,
    /// 제목 문단. 스캔 쪽은 늘 `false`
    pub heading: bool,
    pub status: ParagraphStatus,
}

/// 문단 상태(계약 `ParagraphStatus` + `fail_code`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParagraphStatus {
    Translated,
    Edited,
    /// `TRANSLATION_MISMATCH`·`TRANSLATION_TRUNCATED`
    Failed(FailReason),
    /// `TRANSLATION_REFUSED`
    Refused,
}

/// 기록에도 이번 실패에도 없는 문단·스캔 쪽. 끝난 작업에서는 모든 묶음을 보낸 뒤라 생기지 않고, 직접 고친 글을
/// 지운 실패 문단(번역이 없다)이 이 상태로 돌아간다.
pub(crate) const MISSING_RESULT: FailReason = FailReason::Mismatch;

/// 범위 쪽마다 결과를 만들고 쓴 용어를 고른다. 쪽마다 `arrange`를 알리고, 100%는 모두 만든 뒤 낸다.
pub(super) fn arrange<F: FnMut(TranslateProgress)>(
    pages: &[SourcePage],
    options: &TranslationOptions<'_>,
    run: &Run,
    reporter: &mut ProgressReporter<F>,
) -> (Vec<TranslatedPage>, Vec<GlossaryTerm>) {
    let total = count(pages.len());
    let mut arranged = Vec::with_capacity(pages.len());
    for (index, page) in pages.iter().enumerate() {
        arranged.push(arrange_page(page, run));
        let done = count(index + 1);
        if done < total {
            run.report(reporter, TranslateStage::Arrange, done, total);
        }
    }
    let glossary_used = glossary_used(options.glossary, &arranged);
    run.report(reporter, TranslateStage::Arrange, total, total);
    (arranged, glossary_used)
}

fn arrange_page(page: &SourcePage, run: &Run) -> TranslatedPage {
    match &page.content {
        SourcePageContent::Text(paragraphs) => TranslatedPage {
            page: page.page,
            kind: PageKind::TextLayer,
            paragraphs: paragraphs
                .iter()
                .map(|paragraph| text_paragraph(page.page, paragraph, run))
                .collect(),
            failure: None,
        },
        SourcePageContent::Scan(_) if run.include_scan_pages => {
            match run.record.scan_pages.get(&page.page) {
                Some(recorded) => TranslatedPage {
                    page: page.page,
                    kind: PageKind::Image,
                    paragraphs: recorded
                        .iter()
                        .map(|paragraph| {
                            let (target, status) = recorded_status(
                                paragraph.target.as_ref(),
                                paragraph.edited.as_ref(),
                            );
                            TranslatedParagraph {
                                key: paragraph.key.clone(),
                                number: paragraph.number,
                                source: paragraph.source.clone(),
                                target,
                                heading: false,
                                status,
                            }
                        })
                        .collect(),
                    failure: None,
                },
                None => TranslatedPage {
                    page: page.page,
                    kind: PageKind::Image,
                    paragraphs: Vec::new(),
                    failure: Some(
                        run.scan_failures
                            .get(&page.page)
                            .copied()
                            .unwrap_or(PageFailure::Failed(MISSING_RESULT)),
                    ),
                },
            }
        }
        SourcePageContent::Scan(_) => TranslatedPage {
            page: page.page,
            kind: PageKind::ScanSkipped,
            paragraphs: Vec::new(),
            failure: None,
        },
    }
}

fn text_paragraph(page: u32, paragraph: &SourceParagraph, run: &Run) -> TranslatedParagraph {
    let key = run
        .keys
        .get(&(page, paragraph.number))
        .cloned()
        .unwrap_or_default();
    let (target, status) = match run.record.paragraphs.get(&key) {
        Some(RecordedParagraph { target, edited }) => {
            recorded_status(target.as_ref(), edited.as_ref())
        }
        None => (
            None,
            run.unsettled
                .get(&key)
                .copied()
                .unwrap_or(ParagraphStatus::Failed(MISSING_RESULT)),
        ),
    };
    TranslatedParagraph {
        key,
        number: paragraph.number,
        source: paragraph.text.clone(),
        target,
        heading: paragraph.heading,
        status,
    }
}

/// 기록된 문단의 화면 글과 상태: 직접 고친 글이 있으면 `Edited`, 번역만 있으면 `Translated`다. 둘 다 없으면
/// 기록되지 않은 문단처럼 번역하지 못한 문단이다.
pub(crate) fn recorded_status(
    target: Option<&String>,
    edited: Option<&String>,
) -> (Option<String>, ParagraphStatus) {
    match (edited, target) {
        (Some(edited), _) => (Some(edited.clone()), ParagraphStatus::Edited),
        (None, Some(target)) => (Some(target.clone()), ParagraphStatus::Translated),
        (None, None) => (None, ParagraphStatus::Failed(MISSING_RESULT)),
    }
}

/// 결과 원문(글자층 문단, 받아 적은 스캔 문단)에 원어가 나오는 용어(용어집 순서)
fn glossary_used(glossary: &Glossary, pages: &[TranslatedPage]) -> Vec<GlossaryTerm> {
    let used: BTreeSet<usize> = pages
        .iter()
        .flat_map(|page| &page.paragraphs)
        .flat_map(|paragraph| glossary.indices_in(&paragraph.source))
        .collect();
    used.into_iter()
        .map(|index| glossary.terms()[index].clone())
        .collect()
}
