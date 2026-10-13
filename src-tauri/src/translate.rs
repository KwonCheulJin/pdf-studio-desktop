//! 번역 커맨드의 검증과 위임(ADR 0002 §10, 계획서 §9.1.2 "어댑터"). pdf-core 문단 추출 결과를 crates/translate
//! 입력(`SourcePage`)으로 옮기고, 실행기·계획·다시 번역·직접 고치기를 부른다. 커맨드(`commands.rs`)가 이
//! 함수들을 차례로 부른다: 문단 추출·파일 해시·키체인은 blocking 스레드에서, 전송은 async로.
//!
//! - 경로: 허용 경로 목록(또는 앱 폴더) 안의 PDF만. canonical 경로라 추출 캐시·파일 해시 캐시 키가 같은 파일에서
//!   같다. 추출 메모리 캐시는 비교와 함께 쓴다(`CompareState`).
//! - 검사 순서(`translate_pdf`): 경로 → 용어집 상한 → 범위 → 원문 언어 → 번역할 것 → 키. 검사에서 멈추면 진행
//!   이벤트가 없다. 통과한 뒤 `readDocument` 0%를 알리고 파일 해시를 센 다음 실행기를 부른다.
//! - 파일 해시는 (경로, 크기, 수정 시각)이 같으면 다시 세지 않는다(비교 추출 캐시와 같은 한계, ADR 0001 §15).
//!   계획은 기록 폴더에 기록이 있을 때만 센다.
//! - 이어하기 기록 폴더는 앱 데이터 폴더 `translations/`다(ADR 0002 §8).
//! - 번역·다시 번역은 앱에서 한 번에 하나다. 같은 기록을 두 작업이 함께 고쳐 서로 덮지 않게 한다.

use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Instant, SystemTime};

use pdf_core::{ExtractionCache, PageParagraphs, ParagraphPage, PdfEngine};
use tauri::{App, Manager};
use translate::{
    ApiError, ApiKey, Glossary, Language, LocatedParagraph, ParagraphTarget, PlanInput,
    ProgressReporter, ReqwestTransport, RetranslateError, RunError, ScanImage, ScanRenderer,
    SourcePage, SourcePageContent, SourceParagraph, TranslationJob, TranslationOptions, Transport,
};

use crate::access::{PDF_EXTENSION, PathAccess};
use crate::contract::{
    DetectedLanguage, EditParagraphRequest, GlossaryTerm, RetranslateRequest, RetranslateResult,
    SourceLanguage, TranslateOptions, TranslateRequest, TranslatedPage, TranslatedParagraph,
    TranslationPlan, TranslationResult, count,
};
use crate::error::{CommandError, read_error, write_error};
use crate::secrets::{KeySettings, KeyStore, read_api_key};

/// 이어하기 기록을 두는 앱 데이터 하위 폴더
const RECORD_DIRECTORY: &str = "translations";

/// 번역 커맨드가 함께 쓰는 앱 상태(`app.manage`로 하나)
pub(crate) struct TranslateState<T> {
    record_dir: PathBuf,
    /// 작업마다 빌려 주는 전송(연결 풀). TLS를 준비하지 못했으면 그 오류(`NETWORK_UNAVAILABLE`)다.
    transport: Result<T, ApiError>,
    hashes: FileHashes,
    /// 번역·다시 번역이 도는 중
    running: AtomicBool,
}

/// 앱의 번역 상태(reqwest 전송)
pub(crate) type AppTranslateState = TranslateState<ReqwestTransport>;

impl AppTranslateState {
    /// 앱 데이터 폴더 `translations/`와 `ANTHROPIC_API_BASE`로 보내는 전송. 전송을 만들지 못해도 앱은 뜨고 번역만
    /// 실패한다.
    pub(crate) fn for_app(app: &App) -> Result<Self, Box<dyn Error>> {
        let record_dir = app.path().app_data_dir()?.join(RECORD_DIRECTORY);
        let transport = ReqwestTransport::new()
            .inspect_err(|error| log::error!("번역 전송을 만들지 못했다: {error}"));
        Ok(Self::new(record_dir, transport))
    }
}

impl<T> TranslateState<T> {
    pub(crate) fn new(record_dir: PathBuf, transport: Result<T, ApiError>) -> Self {
        Self {
            record_dir,
            transport,
            hashes: FileHashes::default(),
            running: AtomicBool::new(false),
        }
    }

    pub(crate) fn transport(&self) -> Result<&T, CommandError> {
        self.transport
            .as_ref()
            .map_err(|error| CommandError::Api(error.clone()))
    }

    /// 번역·다시 번역을 시작한다. 이미 하나가 돌고 있으면 `JOB_ALREADY_RUNNING`이다. guard가 사라지면 끝난다.
    pub(crate) fn start(&self, job_id: &str) -> Result<RunningTranslation<'_>, CommandError> {
        self.running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| CommandError::JobAlreadyRunning {
                job_id: job_id.to_owned(),
            })?;
        Ok(RunningTranslation(&self.running))
    }

    /// 이어하기 기록을 모두 지운다(설정 '일반'의 "저장된 번역 지우기").
    pub(crate) fn delete_records(&self) -> Result<(), CommandError> {
        translate::delete_translation_records(&self.record_dir)
            .map_err(|error| write_error(&self.record_dir, error))
    }
}

/// 도는 번역. 사라지면 다음 번역을 받는다.
pub(crate) struct RunningTranslation<'a>(&'a AtomicBool);

impl Drop for RunningTranslation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// 파일 내용 SHA-256 캐시: 경로 → 그때의 크기·수정 시각과 해시
#[derive(Default)]
struct FileHashes {
    entries: Mutex<HashMap<PathBuf, HashedFile>>,
}

#[derive(Clone, Copy)]
struct HashedFile {
    size: u64,
    modified: SystemTime,
    sha256: [u8; 32],
}

impl FileHashes {
    /// 크기·수정 시각이 같으면 앞서 센 해시다. 해시를 세는 동안 잠금을 쥐지 않는다.
    fn sha256(&self, path: &Path) -> Result<[u8; 32], CommandError> {
        let metadata = fs::metadata(path).map_err(|error| read_error(path, error))?;
        let modified = metadata
            .modified()
            .map_err(|error| read_error(path, error))?;
        let size = metadata.len();
        if let Some(cached) = self.lock().get(path).copied()
            && cached.size == size
            && cached.modified == modified
        {
            return Ok(cached.sha256);
        }
        let sha256 = translate::file_sha256(path).map_err(|error| read_error(path, error))?;
        self.lock().insert(
            path.to_path_buf(),
            HashedFile {
                size,
                modified,
                sha256,
            },
        );
        Ok(sha256)
    }

    /// 표는 넣기·찾기만 하므로 다른 스레드가 패닉해도 내용이 깨지지 않는다. 잠금 오염은 무시한다.
    fn lock(&self) -> MutexGuard<'_, HashMap<PathBuf, HashedFile>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// 커맨드가 쓰는 앱 상태
pub(crate) struct Deps<'a, T> {
    pub(crate) engine: &'a PdfEngine,
    pub(crate) access: &'a PathAccess,
    pub(crate) extraction: &'a ExtractionCache,
    pub(crate) state: &'a TranslateState<T>,
}

/// 읽은 문서: 문서 전체 쪽 정보와 범위 안 쪽
struct ReadDocument {
    /// canonical 경로
    path: PathBuf,
    /// 문서 전체 쪽마다 스캔 쪽인가(길이 = 쪽 수)
    scan_flags: Vec<bool>,
    /// 범위 안 쪽(쪽 번호 오름차순)
    pages: Vec<SourcePage>,
    detected: translate::DetectedLanguage,
}

impl ReadDocument {
    fn page_count(&self) -> u32 {
        count(self.scan_flags.len())
    }

    fn has_scan_pages(&self) -> bool {
        self.scan_flags.iter().any(|&scan| scan)
    }
}

/// 경로 → 용어집 상한 → 범위 순으로 검사하고 문서를 읽는다.
fn read_document<T>(
    deps: &Deps<'_, T>,
    path: &Path,
    options: &TranslateOptions,
) -> Result<(ReadDocument, Glossary), CommandError> {
    let path = deps.access.readable(path, &[PDF_EXTENSION])?;
    let glossary = glossary_of(&options.glossary)?;
    let scan_flags = pdf_core::scan_page_flags(deps.engine, &path, deps.extraction)?;
    let pages: Vec<SourcePage> =
        pdf_core::extract_paragraphs(deps.engine, &path, &options.range, deps.extraction)?
            .into_iter()
            .map(source_page)
            .collect();
    let detected = translate::detect_language(&pages);
    let document = ReadDocument {
        path,
        scan_flags,
        pages,
        detected,
    };
    Ok((document, glossary))
}

/// 합친 용어집을 정규화하고 상한(개수·글자 수)을 본다.
fn glossary_of(terms: &[GlossaryTerm]) -> Result<Glossary, CommandError> {
    let glossary = Glossary::new(terms.iter().cloned().map(translate::GlossaryTerm::from));
    glossary
        .check_limits()
        .map_err(|_| CommandError::GlossaryTooLarge)?;
    Ok(glossary)
}

/// pdf-core 문단 쪽 → translate 입력. 상자·글자 크기는 번역에 쓰지 않아 뺀다(ADR 0002 §1).
fn source_page(page: ParagraphPage) -> SourcePage {
    let content = match page.content {
        PageParagraphs::Text(paragraphs) => SourcePageContent::Text(
            paragraphs
                .into_iter()
                .map(|paragraph| SourceParagraph {
                    number: paragraph.number,
                    text: paragraph.text,
                    heading: paragraph.heading,
                })
                .collect(),
        ),
        PageParagraphs::Scan => {
            let (width_px, height_px) = pdf_core::scan_image_size(&page.size);
            SourcePageContent::Scan(ScanImage {
                width_px,
                height_px,
            })
        }
    };
    SourcePage {
        page: page.page,
        content,
    }
}

/// 요청에 실을 원문 언어: 고른 언어, 자동 감지면 감지한 언어(모르면 `None`)
fn request_language(
    source: SourceLanguage,
    detected: translate::DetectedLanguage,
) -> Option<Language> {
    match source {
        SourceLanguage::Auto => detected.language(),
        SourceLanguage::Zh => Some(Language::Zh),
        SourceLanguage::En => Some(Language::En),
    }
}

/// 결과에 보일 언어: 감지한 언어가 요청 언어와 같으면 감지 값(간체·번체를 가른다), 아니면 요청 언어
fn shown_language(language: Language, detected: translate::DetectedLanguage) -> DetectedLanguage {
    if detected.language() == Some(language) {
        detected.into()
    } else {
        match language {
            Language::Zh => DetectedLanguage::Zh,
            Language::En => DetectedLanguage::En,
        }
    }
}

fn translation_options<'a>(
    document: &ReadDocument,
    file_sha256: [u8; 32],
    language: Language,
    glossary: &'a Glossary,
    options: &TranslateOptions,
) -> TranslationOptions<'a> {
    TranslationOptions {
        file_sha256,
        document_has_scan_pages: document.has_scan_pages(),
        language,
        model: options.model.into(),
        glossary,
        include_scan_pages: options.include_scan_pages,
    }
}

/// 실행 전 계획. 네트워크를 쓰지 않고 키를 읽지 않는다(ADR 0002 §10 `prepare_translation`).
pub(crate) fn prepare<T>(
    deps: &Deps<'_, T>,
    path: &Path,
    options: &TranslateOptions,
) -> Result<TranslationPlan, CommandError> {
    let (document, glossary) = read_document(deps, path, options)?;
    let language = request_language(options.source_language, document.detected);
    let record_dir = &deps.state.record_dir;
    let record = match language {
        Some(language) if translate::has_translation_records(record_dir) => {
            let file_sha256 = deps.state.hashes.sha256(&document.path)?;
            let options = translation_options(&document, file_sha256, language, &glossary, options);
            translate::load_translation_record(record_dir, &options)
        }
        _ => None,
    };
    let plan = translate::plan_translation(PlanInput {
        pages: &document.pages,
        glossary: &glossary,
        language,
        model: options.model.into(),
        include_scan_pages: options.include_scan_pages,
        record: record.as_ref(),
    });
    let scan_pages = count(document.scan_flags.iter().filter(|&&scan| scan).count());
    Ok(TranslationPlan {
        page_count: document.page_count(),
        text_pages: document.page_count() - scan_pages,
        scan_pages,
        range_pages: count(document.pages.len()),
        detected_language: document.detected.into(),
        paragraph_count: plan.paragraph_count,
        chunk_count: plan.chunk_count,
        estimated_input_tokens: plan.estimated_input_tokens,
        estimated_output_tokens: plan.estimated_output_tokens,
        estimated_cost_micro_usd: plan.estimated_cost_micro_usd,
        pricing_date: translate::TranslateModel::from(options.model)
            .spec()
            .pricing_date
            .to_owned(),
        resumable: plan.resumable.map(Into::into),
    })
}

/// 검사를 통과한 번역 요청
pub(crate) struct CheckedTranslation {
    job_id: String,
    document: ReadDocument,
    glossary: Glossary,
    language: Language,
    options: TranslateOptions,
    resume: bool,
    key: ApiKey,
}

impl CheckedTranslation {
    pub(crate) fn job_id(&self) -> &str {
        &self.job_id
    }

    pub(crate) fn path(&self) -> &Path {
        &self.document.path
    }

    pub(crate) fn range_pages(&self) -> u32 {
        count(self.document.pages.len())
    }
}

/// `translate_pdf`의 검사: 경로 → 용어집 상한 → 범위 → 원문 언어 → 번역할 것 → 키. 진행 이벤트 전에 부른다.
/// 키는 여기서 한 번 읽어 작업 동안만 메모리에 둔다.
pub(crate) fn check_translation<T>(
    deps: &Deps<'_, T>,
    keys: &impl KeyStore,
    settings: &impl KeySettings,
    request: TranslateRequest,
) -> Result<CheckedTranslation, CommandError> {
    let (document, glossary) = read_document(deps, &request.path, &request.options)?;
    let language = request_language(request.options.source_language, document.detected)
        .ok_or(CommandError::SourceLanguageUnknown)?;
    let has_text = document.pages.iter().any(|page| {
        matches!(&page.content, SourcePageContent::Text(paragraphs) if !paragraphs.is_empty())
    });
    let has_scan = request.options.include_scan_pages
        && document
            .pages
            .iter()
            .any(|page| matches!(page.content, SourcePageContent::Scan(_)));
    if !has_text && !has_scan {
        return Err(CommandError::NoTranslatableText);
    }
    let key = read_api_key(keys, settings)?;
    Ok(CheckedTranslation {
        job_id: request.job_id,
        document,
        glossary,
        language,
        options: request.options,
        resume: request.resume,
        key,
    })
}

/// 파일 내용 SHA-256(기록 키 ①). 크기·수정 시각이 같으면 앞서 센 값이다.
pub(crate) fn hash_file<T>(
    state: &TranslateState<T>,
    path: &Path,
) -> Result<[u8; 32], CommandError> {
    state.hashes.sha256(path)
}

/// 검사·해시를 마친 번역을 실행하고 결과에 범위 밖 쪽을 채운다.
pub(crate) async fn run<T, R, F>(
    state: &TranslateState<T>,
    checked: CheckedTranslation,
    file_sha256: [u8; 32],
    renderer: &mut R,
    reporter: &mut ProgressReporter<F>,
    cancel: &AtomicBool,
    started: Instant,
) -> Result<TranslationResult, CommandError>
where
    T: Transport,
    R: ScanRenderer<Error = CommandError>,
    F: FnMut(translate::TranslateProgress),
{
    let transport = state.transport()?;
    let CheckedTranslation {
        document,
        glossary,
        language,
        options,
        resume,
        key,
        ..
    } = checked;
    let job = TranslationJob {
        pages: &document.pages,
        options: translation_options(&document, file_sha256, language, &glossary, &options),
        resume,
        record_dir: &state.record_dir,
    };
    let output = translate::run_translation(job, transport, key, renderer, reporter, cancel)
        .await
        .map_err(|error| match error {
            RunError::Cancelled => CommandError::Cancelled,
            RunError::Api(error) => CommandError::Api(error),
            RunError::Render(error) => error,
        })?;
    let mut range_pages: HashMap<u32, TranslatedPage> = output
        .pages
        .into_iter()
        .map(|page| (page.page, TranslatedPage::from(page)))
        .collect();
    let pages = (0..document.page_count())
        .map(|page| {
            range_pages
                .remove(&page)
                .unwrap_or_else(|| TranslatedPage::out_of_range(page))
        })
        .collect();
    Ok(TranslationResult {
        record_id: output.record_key,
        path: document.path,
        language: shown_language(language, document.detected),
        model: options.model,
        pages,
        usage: output.usage.into(),
        elapsed_ms: u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX),
        glossary_used: output
            .glossary_used
            .into_iter()
            .map(GlossaryTerm::from)
            .collect(),
    })
}

/// 스캔 쪽 그림을 보내기 직전에 blocking 스레드에서 렌더한다(pdf-core `render_scan_page`가 pdfium 잠금을 잡는다).
pub(crate) struct BlockingRenderer<F> {
    render: F,
}

impl<F> BlockingRenderer<F>
where
    F: Fn(u32) -> Result<Vec<u8>, CommandError> + Clone + Send + 'static,
{
    pub(crate) fn new(render: F) -> Self {
        Self { render }
    }
}

impl<F> ScanRenderer for BlockingRenderer<F>
where
    F: Fn(u32) -> Result<Vec<u8>, CommandError> + Clone + Send + 'static,
{
    type Error = CommandError;

    fn render(&mut self, page: u32) -> impl Future<Output = Result<Vec<u8>, CommandError>> + Send {
        let render = self.render.clone();
        async move {
            tauri::async_runtime::spawn_blocking(move || render(page))
                .await
                .map_err(|error| CommandError::TaskFailed {
                    detail: error.to_string(),
                })?
        }
    }
}

/// 다시 번역·직접 고치기가 고칠 문단
pub(crate) struct ParagraphRequest<'a> {
    pub(crate) record_id: &'a str,
    pub(crate) path: &'a Path,
    pub(crate) key: &'a str,
    pub(crate) options: &'a TranslateOptions,
}

impl<'a> From<&'a RetranslateRequest> for ParagraphRequest<'a> {
    fn from(request: &'a RetranslateRequest) -> Self {
        Self {
            record_id: &request.record_id,
            path: &request.path,
            key: &request.key,
            options: &request.options,
        }
    }
}

impl<'a> From<&'a EditParagraphRequest> for ParagraphRequest<'a> {
    fn from(request: &'a EditParagraphRequest) -> Self {
        Self {
            record_id: &request.record_id,
            path: &request.path,
            key: &request.key,
            options: &request.options,
        }
    }
}

/// 경로 → 용어집 상한 → 범위 → 원문 언어 → 기록 키(파일 해시) → 문단. 기록 키가 결과의 `recordId`와 다르거나
/// 문단이 없으면 `TRANSLATION_RECORD_NOT_FOUND`다.
pub(crate) fn locate<T>(
    deps: &Deps<'_, T>,
    request: ParagraphRequest<'_>,
) -> Result<LocatedParagraph, CommandError> {
    let (document, glossary) = read_document(deps, request.path, request.options)?;
    let language = request_language(request.options.source_language, document.detected)
        .ok_or(CommandError::SourceLanguageUnknown)?;
    let file_sha256 = deps.state.hashes.sha256(&document.path)?;
    translate::locate_paragraph(ParagraphTarget {
        pages: &document.pages,
        options: translation_options(&document, file_sha256, language, &glossary, request.options),
        record_dir: &deps.state.record_dir,
        record_key: request.record_id,
        key: request.key,
    })
    .map_err(|_| CommandError::TranslationRecordNotFound)
}

/// 찾은 문단을 다시 번역한다.
pub(crate) async fn retranslate<T: Transport>(
    state: &TranslateState<T>,
    located: LocatedParagraph,
    key: ApiKey,
    cancel: &AtomicBool,
) -> Result<RetranslateResult, CommandError> {
    let retranslated = translate::retranslate_paragraph(located, state.transport()?, key, cancel)
        .await
        .map_err(|error| match error {
            RetranslateError::Cancelled => CommandError::Cancelled,
            RetranslateError::Api(error) => CommandError::Api(error),
        })?;
    Ok(RetranslateResult {
        paragraph: retranslated.paragraph.into(),
        usage: retranslated.usage.into(),
    })
}

/// 찾은 문단에 직접 고친 글을 쓴다.
pub(crate) fn edit<T>(
    state: &TranslateState<T>,
    located: LocatedParagraph,
    text: &str,
) -> Result<TranslatedParagraph, CommandError> {
    translate::edit_translated_paragraph(located, text)
        .map(TranslatedParagraph::from)
        .map_err(|error| write_error(&state.record_dir, error))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;
    use serde_json::{Value, json};
    use translate::{HttpResponse, TransportError};

    use super::*;
    use crate::contract::{PageKind, ParagraphStatus, ResumeState, TranslateModel};
    use crate::error::{AppError, ErrorCode};
    use crate::test_support::{
        FakeCall, FakeKeySettings, FakeKeyStore, FakeTransport, TestDir, engine, reply,
    };

    const FIXTURE: &str = "paragraphs-zh-hans.pdf";
    /// 픽스처 0쪽(글자층 문단 15개), 1쪽(스캔 쪽), 2쪽(글자층 문단 5개, `/Rotate 90`)
    const TEXT_PAGE_PARAGRAPHS: usize = 15;
    const KEY: &str = "sk-ant-api03-translate-flow-test-key";
    const SCAN_SOURCE: &str = "第四章 附则";
    const SCAN_TARGET: &str = "제4장 부칙";
    const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

    /// 고른 픽스처 하나와 번역 상태(기록 폴더는 테스트 폴더 안)
    struct Setup {
        test_dir: TestDir,
        access: PathAccess,
        extraction: ExtractionCache,
        state: TranslateState<FakeTransport>,
        path: PathBuf,
    }

    impl Setup {
        fn new(name: &str) -> Self {
            let test_dir = TestDir::new(name);
            let access = test_dir.access();
            let path = access
                .allow_opened(&test_dir.copy_fixture(FIXTURE, "document.pdf"))
                .expect("pick fixture");
            let state = TranslateState::new(
                test_dir.user("translations"),
                Ok(FakeTransport::new(echo_translator)),
            );
            Self {
                test_dir,
                access,
                extraction: ExtractionCache::new(),
                state,
                path,
            }
        }

        fn deps(&self) -> Deps<'_, FakeTransport> {
            Deps {
                engine: engine(),
                access: &self.access,
                extraction: &self.extraction,
                state: &self.state,
            }
        }

        fn calls(&self) -> Vec<FakeCall> {
            self.state.transport().expect("transport").calls()
        }
    }

    fn options(
        source_language: SourceLanguage,
        range: &str,
        include_scan_pages: bool,
    ) -> TranslateOptions {
        TranslateOptions {
            source_language,
            range: range.to_owned(),
            include_scan_pages,
            model: TranslateModel::Sonnet,
            glossary: Vec::new(),
        }
    }

    fn request(path: &Path, options: TranslateOptions) -> TranslateRequest {
        TranslateRequest {
            job_id: "translate-1".to_owned(),
            path: path.to_path_buf(),
            options,
            resume: true,
        }
    }

    /// 받은 항목마다 `번역 <id>`로, 스캔 쪽은 문단 하나를 받아 적은 것처럼 답한다(Messages 200 응답 모양).
    fn echo_translator(call: &FakeCall) -> Result<HttpResponse, TransportError> {
        let FakeCall::Messages(body) = call else {
            return reply(404, "{}");
        };
        let content = &body["messages"][0]["content"];
        let output = if content[0]["type"] == "image" {
            json!({ "paragraphs": [{ "source": SCAN_SOURCE, "text": SCAN_TARGET }] })
        } else {
            let text = content[0]["text"].as_str().expect("user text");
            let start = text.find("<paragraphs>\n").expect("<paragraphs>") + "<paragraphs>\n".len();
            let end = text.find("\n</paragraphs>").expect("</paragraphs>");
            let items: Vec<Value> = serde_json::from_str(&text[start..end]).expect("items");
            let paragraphs: Vec<Value> = items
                .iter()
                .map(|item| json!({ "id": item["id"], "text": format!("번역 {}", item["id"].as_str().expect("id")) }))
                .collect();
            json!({ "paragraphs": paragraphs })
        };
        let message = json!({
            "content": [{ "type": "text", "text": output.to_string() }],
            "stop_reason": "end_turn",
            "usage": { "input_tokens": 100, "output_tokens": 50 },
        });
        reply(200, &message.to_string())
    }

    struct Translated {
        result: Result<TranslationResult, CommandError>,
        events: Vec<translate::TranslateProgress>,
    }

    /// 커맨드(`commands::translate_pdf`)와 같은 차례: 검사 → `readDocument` 0% → 파일 해시 → 실행
    fn translate_like_command(
        setup: &Setup,
        keys: &FakeKeyStore,
        request: TranslateRequest,
    ) -> Translated {
        let mut events = Vec::new();
        let result = (|| {
            let checked =
                check_translation(&setup.deps(), keys, &FakeKeySettings::default(), request)?;
            let mut reporter =
                ProgressReporter::new(checked.job_id(), |progress| events.push(progress));
            reporter.read_document_started(checked.range_pages());
            let file_sha256 = hash_file(&setup.state, checked.path())?;
            let path = checked.path().to_path_buf();
            let mut renderer = BlockingRenderer::new(move |page| {
                pdf_core::render_scan_page(engine(), &path, page).map_err(CommandError::from)
            });
            tauri::async_runtime::block_on(run(
                &setup.state,
                checked,
                file_sha256,
                &mut renderer,
                &mut reporter,
                &AtomicBool::new(false),
                Instant::now(),
            ))
        })();
        Translated { result, events }
    }

    /// 고르지 않은 파일은 문서를 읽기 전에 거부한다. 계획은 문서 전체 쪽 수(글자층·스캔)와 범위 쪽·문단·묶음을
    /// 세고 전송을 부르지 않는다. 묶음: 스캔 쪽을 보내면 스캔 쪽이 텍스트 묶음을 끊어 0쪽 · 1쪽(스캔) · 2쪽 셋,
    /// 0쪽만이면 하나(문단 15개 글 토큰 531 + 고정 600 < 2,500, Python으로 셈).
    #[test]
    fn plan_counts_the_document_and_range_without_calling_the_api() {
        let setup = Setup::new("translate-plan");
        let not_picked = setup.test_dir.copy_fixture(FIXTURE, "other.pdf");

        let rejected = prepare(
            &setup.deps(),
            &not_picked,
            &options(SourceLanguage::Auto, "", true),
        )
        .expect_err("not picked");
        let whole = prepare(
            &setup.deps(),
            &setup.path,
            &options(SourceLanguage::Auto, "", true),
        )
        .expect("whole plan");
        let first_page = prepare(
            &setup.deps(),
            &setup.path,
            &options(SourceLanguage::Auto, "1", false),
        )
        .expect("first page plan");

        let rejected = AppError::from(rejected);
        assert_eq!(
            (rejected.code, rejected.path),
            (ErrorCode::PathNotAllowed, None)
        );
        let counts = |plan: &TranslationPlan| {
            (
                plan.page_count,
                plan.text_pages,
                plan.scan_pages,
                plan.range_pages,
                plan.paragraph_count,
                plan.chunk_count,
            )
        };
        assert_eq!(counts(&whole), (3, 2, 1, 3, 20, 3));
        assert_eq!(counts(&first_page), (3, 2, 1, 1, 15, 1));
        assert_eq!(whole.detected_language, DetectedLanguage::ZhHans);
        assert_eq!(whole.pricing_date, "2026-10-13");
        assert!(whole.estimated_input_tokens > first_page.estimated_input_tokens);
        assert_eq!(whole.resumable, None);
        assert!(setup.calls().is_empty(), "계획은 전송을 부르지 않는다");
    }

    /// 검사는 원문 언어 → 번역할 것 → 키 차례이고 키체인은 마지막에 읽는다(앞 검사에서 멈추면 읽지 않는다).
    /// 스캔 쪽(1쪽)만 고르면 글이 없어 자동 감지는 모름이고, 스캔 쪽을 보내지 않으면 번역할 것이 없다.
    #[test]
    fn checks_stop_in_order_and_read_the_keychain_last() {
        let setup = Setup::new("translate-checks");
        let cases = [
            (
                SourceLanguage::Auto,
                "2",
                ErrorCode::SourceLanguageUnknown,
                0,
            ),
            (SourceLanguage::Zh, "2", ErrorCode::NoTranslatableText, 0),
            (SourceLanguage::Zh, "1", ErrorCode::ApiKeyMissing, 1),
        ];
        for (source_language, range, code, keychain_reads) in cases {
            let keys = FakeKeyStore::default();

            let error = check_translation(
                &setup.deps(),
                &keys,
                &FakeKeySettings::default(),
                request(&setup.path, options(source_language, range, false)),
            )
            .err()
            .expect("rejected");

            assert_eq!(error.code(), code, "{range}");
            assert_eq!(keys.reads(), keychain_reads, "{range}");
        }
    }

    /// 범위 밖 쪽은 `outOfRange`로 채워 결과가 문서 전체 쪽(색인 = 쪽 번호)이다. 기록 키의 스캔 옵션은 범위가 아니라
    /// 문서에 스캔 쪽이 있는지로 정한다(0쪽만 보내도 문서 1쪽이 스캔이라 `1`). 기대 기록 키는 Python `hashlib`로
    /// 셈한 값이다(픽스처 SHA-256, `zh`, `claude-sonnet-5-5`, 빈 용어집, `1`, `PROMPT_VERSION` `1`).
    #[test]
    fn result_covers_every_page_and_keys_the_record_by_the_whole_document() {
        let setup = Setup::new("translate-result");

        let translated = translate_like_command(
            &setup,
            &FakeKeyStore::with_key(KEY),
            request(&setup.path, options(SourceLanguage::Auto, "1", true)),
        );

        let result = translated.result.expect("translated");
        assert_eq!(result.record_id, "637c42de9c23a11ea2ba47f4acf22631");
        assert_eq!(result.path, setup.path);
        assert_eq!(result.language, DetectedLanguage::ZhHans);
        let kinds: Vec<PageKind> = result.pages.iter().map(|page| page.kind).collect();
        assert_eq!(
            kinds,
            [
                PageKind::TextLayer,
                PageKind::OutOfRange,
                PageKind::OutOfRange
            ]
        );
        let first_page = &result.pages[0].paragraphs;
        assert_eq!(first_page.len(), TEXT_PAGE_PARAGRAPHS);
        assert_eq!(
            (
                first_page[0].target.as_deref(),
                first_page[0].status,
                first_page[0].fail_code
            ),
            (Some("번역 1"), ParagraphStatus::Translated, None)
        );
        assert_eq!(setup.calls().len(), 1);
        let first = translated.events.first().expect("first event");
        assert_eq!(
            (first.stage, first.done, first.total, first.overall_percent),
            (translate::TranslateStage::ReadDocument, 0, 1, 0)
        );
        assert_eq!(
            translated
                .events
                .last()
                .expect("last event")
                .overall_percent,
            100
        );
    }

    /// 번역이 쓴 기록을 계획(이어하기: 끝난 문단 15 / 15, 보낼 것 없음)과 직접 고치기가 같은 기록 키로 찾는다.
    /// 결과와 다른 기록 키로 고치면 `TRANSLATION_RECORD_NOT_FOUND`다.
    #[test]
    fn plan_and_edit_find_the_record_the_translation_wrote() {
        let setup = Setup::new("translate-record");
        let options = options(SourceLanguage::Auto, "1", true);
        let result = translate_like_command(
            &setup,
            &FakeKeyStore::with_key(KEY),
            request(&setup.path, options.clone()),
        )
        .result
        .expect("translated");
        let key = result.pages[0].paragraphs[2].key.clone();
        let paragraph = |record_id| ParagraphRequest {
            record_id,
            path: &setup.path,
            key: &key,
            options: &options,
        };

        let plan = prepare(&setup.deps(), &setup.path, &options).expect("plan");
        let located = locate(&setup.deps(), paragraph(&result.record_id)).expect("paragraph");
        let edited = edit(&setup.state, located, "  직접 고친 번역 ").expect("edited");
        let other_record = locate(&setup.deps(), paragraph("0123456789abcdef0123456789abcdef"))
            .err()
            .expect("other record");

        assert_eq!(
            plan.resumable,
            Some(ResumeState {
                translated_paragraphs: 15,
                paragraph_count: 15,
            })
        );
        assert_eq!(
            (plan.estimated_input_tokens, plan.estimated_cost_micro_usd),
            (0, 0)
        );
        assert_eq!(
            (edited.target.as_deref(), edited.status),
            (Some("직접 고친 번역"), ParagraphStatus::Edited)
        );
        assert_eq!(other_record.code(), ErrorCode::TranslationRecordNotFound);
    }

    /// 스캔 쪽 그림은 보내기 직전에 렌더해(긴 변 1568px PNG) 그림 블록으로 보내고, 받아 적은 문단이 `image` 쪽이 된다.
    #[test]
    fn scan_pages_are_rendered_and_sent_as_images() {
        let setup = Setup::new("translate-scan");

        let result = translate_like_command(
            &setup,
            &FakeKeyStore::with_key(KEY),
            request(&setup.path, options(SourceLanguage::Zh, "2", true)),
        )
        .result
        .expect("translated");

        let calls = setup.calls();
        let [FakeCall::Messages(body)] = calls.as_slice() else {
            panic!("요청 하나여야 한다");
        };
        let image = &body["messages"][0]["content"][0];
        assert_eq!(image["source"]["media_type"], "image/png");
        let png = STANDARD
            .decode(image["source"]["data"].as_str().expect("base64"))
            .expect("PNG bytes");
        assert!(png.starts_with(PNG_SIGNATURE));
        let height = u32::from_be_bytes(png[20..24].try_into().expect("IHDR height"));
        assert_eq!(height, pdf_core::SCAN_IMAGE_MAX_EDGE_PX);
        let scan_page = &result.pages[1];
        assert_eq!(scan_page.kind, PageKind::Image);
        assert_eq!(
            scan_page
                .paragraphs
                .iter()
                .map(|paragraph| (paragraph.source.as_str(), paragraph.target.as_deref()))
                .collect::<Vec<_>>(),
            [(SCAN_SOURCE, Some(SCAN_TARGET))]
        );
    }

    /// 번역·다시 번역은 앱에서 한 번에 하나다. 앞 작업이 끝나면 다음을 받는다.
    #[test]
    fn only_one_translation_runs_at_a_time() {
        let state = TranslateState::new(PathBuf::new(), Ok(FakeTransport::new(echo_translator)));

        let first = state.start("translate-a").expect("first");
        let second = state
            .start("translate-b")
            .err()
            .expect("second is rejected");
        drop(first);

        assert_eq!(second.code(), ErrorCode::JobAlreadyRunning);
        assert!(state.start("translate-c").is_ok());
    }

    /// 파일 해시는 내용으로 세고, 같은 경로라도 크기·수정 시각이 바뀌면 다시 센다. 기대값은 Python `hashlib`다.
    #[test]
    fn file_hash_is_recounted_when_the_file_changes() {
        let test_dir = TestDir::new("translate-file-hash");
        let path = test_dir.user("document.pdf");
        let hashes = FileHashes::default();
        let hex =
            |hash: [u8; 32]| -> String { hash.iter().map(|byte| format!("{byte:02x}")).collect() };

        fs::write(&path, b"one").expect("write");
        let first = hashes.sha256(&path).expect("first hash");
        fs::write(&path, b"two!!").expect("rewrite");
        let second = hashes.sha256(&path).expect("second hash");

        assert_eq!(
            hex(first),
            "7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed"
        );
        assert_eq!(
            hex(second),
            "4314ff0966bd416f90e53f90733cdc0ffb11097ca21befbb1cdb9780cb02a82c"
        );
    }
}
