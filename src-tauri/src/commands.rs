//! Tauri 커맨드. 입력을 받아 처리 함수(`files`, `merge`, `compare`, `report`, `translate`, `secrets`)에 넘기기만
//! 한다. pdfium·파일·키체인 작업은 `spawn_blocking` 스레드에서 돌려 UI 스레드와 async 런타임을 막지 않는다.
//! 번역 전송(Anthropic API)은 async로 기다린다.

use std::path::PathBuf;
use std::time::Instant;

use pdf_core::{MAX_INPUT_FILE_BYTES, MAX_MERGE_FILES, PdfEngine};
use specta::Types;
use specta::datatype::DataType;
use tauri::ipc::{Channel, InvokeResponseBody, IpcResponse, Response};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_specta::collect_commands;
use translate::{
    API_KEY_MAX_LEN, API_KEY_PREFIX, MAX_GLOSSARY_TERM_CHARS, MAX_GLOSSARY_TERMS, ProgressReporter,
    ReqwestTransport,
};

use crate::access::{OPENABLE_EXTENSIONS, PDF_EXTENSION, PathAccess};
use crate::compare::CompareState;
use crate::contract::{
    ApiKeyStatus, CompareProgress, CompareRequest, CompareResult, EditParagraphRequest,
    ExportAnnotatedPdfRequest, ExportComparePdfRequest, ExportedFile, MergeProgress, MergeRequest,
    MergeResult, OpenedFile, PreviewCompareReportRequest, ReportPreview, RetranslateRequest,
    RetranslateResult, SaveDialogOptions, SaveDirectoryDialogOptions, TranslateOptions,
    TranslateProgress, TranslateRequest, TranslatedParagraph, TranslationPlan, TranslationResult,
};
use crate::error::{AppError, CommandError};
use crate::jobs::JobRegistry;
use crate::notices::THIRD_PARTY_NOTICES_FILE;
use crate::secrets::{AppSettings, Keychain};
use crate::translate::{AppTranslateState, BlockingRenderer, Deps, ParagraphRequest};
use crate::{compare, files, merge, notices, report, secrets, translate as translation};

/// 열기 다이얼로그의 형식 필터 이름. 언어와 무관한 형식 이름만 쓴다.
const OPENABLE_FILTER_NAME: &str = "PDF, TIFF";
const PDF_FILTER_NAME: &str = "PDF";

/// TS에 내보내는 상수 이름. TS는 이 값을 다시 적지 않고 바인딩에서 가져온다.
const OPENABLE_EXTENSIONS_CONSTANT: &str = "OPENABLE_EXTENSIONS";
const MAX_INPUT_FILE_BYTES_CONSTANT: &str = "MAX_INPUT_FILE_BYTES";
const MAX_MERGE_FILES_CONSTANT: &str = "MAX_MERGE_FILES";
const MAX_GLOSSARY_TERMS_CONSTANT: &str = "MAX_GLOSSARY_TERMS";
const MAX_GLOSSARY_TERM_CHARS_CONSTANT: &str = "MAX_GLOSSARY_TERM_CHARS";
const API_KEY_PREFIX_CONSTANT: &str = "API_KEY_PREFIX";
const API_KEY_MAX_LEN_CONSTANT: &str = "API_KEY_MAX_LEN";

/// JS 숫자로 보내려면 `u32`여야 한다. 상한을 바꿔 넘치면 컴파일이 멈춘다.
const MAX_INPUT_FILE_BYTES_FOR_TS: u32 = {
    assert!(MAX_INPUT_FILE_BYTES <= u32::MAX as u64);
    MAX_INPUT_FILE_BYTES as u32
};
const MAX_MERGE_FILES_FOR_TS: u32 = {
    assert!(MAX_MERGE_FILES <= u32::MAX as usize);
    MAX_MERGE_FILES as u32
};
const MAX_GLOSSARY_TERMS_FOR_TS: u32 = {
    assert!(MAX_GLOSSARY_TERMS <= u32::MAX as usize);
    MAX_GLOSSARY_TERMS as u32
};
const MAX_GLOSSARY_TERM_CHARS_FOR_TS: u32 = {
    assert!(MAX_GLOSSARY_TERM_CHARS <= u32::MAX as usize);
    MAX_GLOSSARY_TERM_CHARS as u32
};
const API_KEY_MAX_LEN_FOR_TS: u32 = {
    assert!(API_KEY_MAX_LEN <= u32::MAX as usize);
    API_KEY_MAX_LEN as u32
};

/// 커맨드·상수를 등록한 tauri-specta 빌더. 앱 실행과 바인딩 생성이 같은 목록을 쓴다.
pub(crate) fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        .commands(collect_commands![
            pick_files,
            pick_save_path,
            pick_save_directory,
            open_files,
            read_pdf,
            merge_pdfs,
            compare_pdfs,
            preview_compare_report,
            export_compare_pdf,
            export_annotated_pdf,
            cancel_job,
            copy_file,
            discard_temp,
            cleanup_temp,
            read_third_party_notices,
            get_api_key_status,
            verify_api_key,
            save_api_key,
            delete_api_key,
            prepare_translation,
            translate_pdf,
            retranslate_paragraph,
            edit_translated_paragraph,
            delete_translation_records,
        ])
        .constant(OPENABLE_EXTENSIONS_CONSTANT, OPENABLE_EXTENSIONS)
        .constant(MAX_INPUT_FILE_BYTES_CONSTANT, MAX_INPUT_FILE_BYTES_FOR_TS)
        .constant(MAX_MERGE_FILES_CONSTANT, MAX_MERGE_FILES_FOR_TS)
        .constant(MAX_GLOSSARY_TERMS_CONSTANT, MAX_GLOSSARY_TERMS_FOR_TS)
        .constant(
            MAX_GLOSSARY_TERM_CHARS_CONSTANT,
            MAX_GLOSSARY_TERM_CHARS_FOR_TS,
        )
        .constant(API_KEY_PREFIX_CONSTANT, API_KEY_PREFIX)
        .constant(API_KEY_MAX_LEN_CONSTANT, API_KEY_MAX_LEN_FOR_TS)
}

/// 열기 다이얼로그를 열고, 고른 파일을 허용 경로 목록에 기록한 뒤 canonical 경로를 돌려준다.
/// 취소하면 빈 목록이다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn pick_files(app: AppHandle) -> Result<Vec<PathBuf>, AppError> {
    run_blocking(app, |app| {
        let picked = app
            .dialog()
            .file()
            .add_filter(OPENABLE_FILTER_NAME, &OPENABLE_EXTENSIONS)
            .blocking_pick_files()
            .unwrap_or_default();
        let access = path_access(app)?;
        picked
            .into_iter()
            .map(|file| access.allow_opened(&local_path(file)?))
            .collect()
    })
    .await
}

/// 저장 다이얼로그를 열고, 고른 경로를 허용 경로 목록에 기록한 뒤 돌려준다. 취소하면 `null`이다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn pick_save_path(
    app: AppHandle,
    options: SaveDialogOptions,
) -> Result<Option<PathBuf>, AppError> {
    run_blocking(app, move |app| {
        let mut dialog = app
            .dialog()
            .file()
            .add_filter(PDF_FILTER_NAME, &[PDF_EXTENSION]);
        if let Some(default_path) = &options.default_path {
            if let Some(directory) = default_path.parent() {
                dialog = dialog.set_directory(directory);
            }
            if let Some(file_name) = default_path.file_name() {
                dialog = dialog.set_file_name(file_name.to_string_lossy());
            }
        }
        let Some(picked) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let access = path_access(app)?;
        access.allow_save_target(&local_path(picked)?).map(Some)
    })
    .await
}

/// 폴더 다이얼로그를 열고, 고른 폴더를 내보내기 폴더로 허용 경로 목록에 기록한 뒤 canonical 경로를
/// 돌려준다. 취소하면 `null`이다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn pick_save_directory(
    app: AppHandle,
    options: SaveDirectoryDialogOptions,
) -> Result<Option<PathBuf>, AppError> {
    run_blocking(app, move |app| {
        let mut dialog = app.dialog().file();
        if let Some(directory) = &options.default_directory {
            dialog = dialog.set_directory(directory);
        }
        let Some(picked) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let access = path_access(app)?;
        access.allow_save_directory(&local_path(picked)?).map(Some)
    })
    .await
}

/// 파일 추가. 파일별 성공/오류를 입력 순서대로 돌려준다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn open_files(
    app: AppHandle,
    paths: Vec<PathBuf>,
) -> Result<Vec<OpenedFile>, AppError> {
    run_blocking(app, move |app| {
        Ok(files::open_files(
            engine(app)?.inner(),
            path_access(app)?.inner(),
            &paths,
        ))
    })
    .await
}

/// pdf.js 표시용 PDF 바이트
#[tauri::command]
#[specta::specta]
pub(crate) async fn read_pdf(app: AppHandle, path: PathBuf) -> Result<PdfBytes, AppError> {
    run_blocking(app, move |app| {
        let bytes = files::read_pdf(path_access(app)?.inner(), &path)?;
        Ok(PdfBytes(Response::new(bytes)))
    })
    .await
}

/// 병합. 진행률은 `on_progress`로, 취소는 `cancel_job(request.jobId)`로 한다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn merge_pdfs(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    request: MergeRequest,
    on_progress: Channel<MergeProgress>,
) -> Result<MergeResult, AppError> {
    let job = jobs.start(&request.job_id)?;
    let cancel = job.token();
    run_blocking(app, move |app| {
        merge::merge(
            engine(app)?.inner(),
            path_access(app)?.inner(),
            &request,
            &cancel,
            |progress| {
                // 받는 창이 닫혔으면 보낼 곳이 없다. 병합은 계속한다.
                let _ = on_progress.send(progress);
            },
        )
    })
    .await
}

/// 두 PDF 비교. 진행률은 `on_progress`로, 취소는 `cancel_job(request.jobId)`로 한다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn compare_pdfs(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    request: CompareRequest,
    on_progress: Channel<CompareProgress>,
) -> Result<CompareResult, AppError> {
    let job = jobs.start(&request.job_id)?;
    let cancel = job.token();
    run_blocking(app, move |app| {
        compare::compare(
            engine(app)?.inner(),
            path_access(app)?.inner(),
            compare_state(app)?.inner(),
            &request,
            &cancel,
            |progress| {
                // 받는 창이 닫혔으면 보낼 곳이 없다. 비교는 계속한다.
                let _ = on_progress.send(progress);
            },
        )
    })
    .await
}

/// 비교 PDF 미리보기(앞 몇 장의 PNG와 전체 장 수). 파일은 쓰지 않는다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn preview_compare_report(
    app: AppHandle,
    request: PreviewCompareReportRequest,
) -> Result<ReportPreview, AppError> {
    run_blocking(app, move |app| {
        report::preview_compare_report(engine(app)?.inner(), path_access(app)?.inner(), request)
    })
    .await
}

/// 비교 PDF 내보내기. 취소는 `cancel_job(request.jobId)`로 한다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn export_compare_pdf(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    request: ExportComparePdfRequest,
) -> Result<ExportedFile, AppError> {
    let job = jobs.start(&request.job_id)?;
    let cancel = job.token();
    run_blocking(app, move |app| {
        report::export_compare_pdf(
            engine(app)?.inner(),
            path_access(app)?.inner(),
            request,
            &cancel,
        )
    })
    .await
}

/// 주석 PDF 내보내기. 취소는 `cancel_job(request.jobId)`로 한다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn export_annotated_pdf(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    request: ExportAnnotatedPdfRequest,
) -> Result<ExportedFile, AppError> {
    let job = jobs.start(&request.job_id)?;
    let cancel = job.token();
    run_blocking(app, move |app| {
        report::export_annotated_pdf(
            engine(app)?.inner(),
            path_access(app)?.inner(),
            request,
            &cancel,
        )
    })
    .await
}

/// 작업 취소. 이미 끝났거나 없는 작업이면 아무 일도 하지 않는다.
#[tauri::command]
#[specta::specta]
pub(crate) fn cancel_job(jobs: State<'_, JobRegistry>, job_id: String) {
    jobs.cancel(&job_id);
}

/// 이 실행의 병합 미리보기 결과를 저장 다이얼로그에서 고른 경로로 복사한다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn copy_file(
    app: AppHandle,
    source: PathBuf,
    destination: PathBuf,
) -> Result<(), AppError> {
    run_blocking(app, move |app| {
        files::copy_file(path_access(app)?.inner(), &source, &destination)
    })
    .await
}

/// 이 실행의 병합 미리보기 결과 하나를 지운다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn discard_temp(app: AppHandle, path: PathBuf) -> Result<(), AppError> {
    run_blocking(app, move |app| {
        files::discard_temp(path_access(app)?.inner(), &path)
    })
    .await
}

/// 이 실행의 병합 미리보기 결과를 모두 지운다. 다른 실행의 결과는 건드리지 않는다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn cleanup_temp(app: AppHandle) -> Result<(), AppError> {
    run_blocking(app, |app| path_access(app)?.cleanup_session()).await
}

/// 앱과 함께 번들한 제3자 고지(마크다운 원문). 경로를 받지 않고 리소스 폴더의 고정 파일만 읽는다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn read_third_party_notices(app: AppHandle) -> Result<String, AppError> {
    run_blocking(app, |app| {
        let resource_dir =
            app.path()
                .resource_dir()
                .map_err(|error| CommandError::ResourceUnavailable {
                    name: THIRD_PARTY_NOTICES_FILE,
                    detail: error.to_string(),
                })?;
        notices::read_third_party_notices(&resource_dir)
    })
    .await
}

/// API 키 등록 상태. 설정 저장소의 힌트만 보고 키체인을 읽지 않는다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn get_api_key_status(app: AppHandle) -> Result<ApiKeyStatus, AppError> {
    run_blocking(app, |app| {
        Ok(secrets::api_key_status(&AppSettings::new(app)))
    })
    .await
}

/// 키 형식 검사 뒤 모델 목록을 한 번 받아 키를 확인한다. 저장하지 않고 문서를 보내지 않는다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn verify_api_key(app: AppHandle, key: String) -> Result<(), AppError> {
    let state = translate_state(&app)?;
    secrets::verify_api_key(state.transport()?, &key)
        .await
        .map_err(AppError::from)
}

/// 키를 키체인에 저장하고 끝 4자리 힌트를 남긴다. 외부 전송 확인을 다시 받게 한다. 네트워크를 쓰지 않는다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn save_api_key(app: AppHandle, key: String) -> Result<ApiKeyStatus, AppError> {
    run_blocking(app, move |app| {
        secrets::save_api_key(&keychain(app), &AppSettings::new(app), &key)
    })
    .await
}

/// 키체인 항목과 힌트를 지운다. 항목이 없어도 성공이다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn delete_api_key(app: AppHandle) -> Result<ApiKeyStatus, AppError> {
    run_blocking(app, |app| {
        secrets::delete_api_key(&keychain(app), &AppSettings::new(app))
    })
    .await
}

/// 실행 전 확인(쪽·문단·묶음·예상 토큰·요금·이어하기). 네트워크를 쓰지 않고 키를 읽지 않는다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn prepare_translation(
    app: AppHandle,
    path: PathBuf,
    options: TranslateOptions,
) -> Result<TranslationPlan, AppError> {
    run_blocking(app, move |app| {
        translation::prepare(&translate_deps(app)?, &path, &options)
    })
    .await
}

/// PDF 번역. 진행률은 `on_progress`로, 취소는 `cancel_job(request.jobId)`로 한다. 번역은 한 번에 하나다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn translate_pdf(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    request: TranslateRequest,
    on_progress: Channel<TranslateProgress>,
) -> Result<TranslationResult, AppError> {
    let job = jobs.start(&request.job_id)?;
    let cancel = job.token();
    let state = translate_state(&app)?;
    let _running = state.start(&request.job_id)?;
    let started = Instant::now();
    let checked = run_blocking(app.clone(), move |app| {
        translation::check_translation(
            &translate_deps(app)?,
            &keychain(app),
            &AppSettings::new(app),
            request,
        )
    })
    .await?;
    let mut reporter = ProgressReporter::new(checked.job_id(), |progress| {
        // 받는 창이 닫혔으면 보낼 곳이 없다. 번역은 계속한다.
        let _ = on_progress.send(progress.into());
    });
    reporter.read_document_started(checked.range_pages());
    let path = checked.path().to_path_buf();
    let file_sha256 = run_blocking(app.clone(), {
        let path = path.clone();
        move |app| translation::hash_file(translate_state(app)?.inner(), &path)
    })
    .await?;
    let render_app = app.clone();
    let mut renderer = BlockingRenderer::new(move |page| {
        pdf_core::render_scan_page(engine(&render_app)?.inner(), &path, page)
            .map_err(CommandError::from)
    });
    translation::run(
        state.inner(),
        checked,
        file_sha256,
        &mut renderer,
        &mut reporter,
        &cancel,
        started,
    )
    .await
    .map_err(AppError::from)
}

/// 문단 하나를 앞뒤 문단 문맥과 함께 다시 번역한다. 취소는 `cancel_job(request.jobId)`로 한다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn retranslate_paragraph(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    request: RetranslateRequest,
) -> Result<RetranslateResult, AppError> {
    let job = jobs.start(&request.job_id)?;
    let cancel = job.token();
    let state = translate_state(&app)?;
    let _running = state.start(&request.job_id)?;
    let (located, key) = run_blocking(app.clone(), move |app| {
        let located = translation::locate(&translate_deps(app)?, ParagraphRequest::from(&request))?;
        let key = secrets::read_api_key(&keychain(app), &AppSettings::new(app))?;
        Ok((located, key))
    })
    .await?;
    translation::retranslate(state.inner(), located, key, &cancel)
        .await
        .map_err(AppError::from)
}

/// 직접 고친 글을 이어하기 기록에 쓴다. 네트워크를 쓰지 않는다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn edit_translated_paragraph(
    app: AppHandle,
    request: EditParagraphRequest,
) -> Result<TranslatedParagraph, AppError> {
    run_blocking(app, move |app| {
        let deps = translate_deps(app)?;
        let located = translation::locate(&deps, ParagraphRequest::from(&request))?;
        translation::edit(deps.state, located, &request.text)
    })
    .await
}

/// 이어하기 기록을 모두 지운다.
#[tauri::command]
#[specta::specta]
pub(crate) async fn delete_translation_records(app: AppHandle) -> Result<(), AppError> {
    run_blocking(app, |app| translate_state(app)?.delete_records()).await
}

/// pdf.js에 넘길 PDF 바이트. JSON 숫자 배열이 아니라 그대로 보내 JS에서 `ArrayBuffer`로 받는다.
pub(crate) struct PdfBytes(Response);

impl IpcResponse for PdfBytes {
    fn body(self) -> tauri::Result<InvokeResponseBody> {
        self.0.body()
    }
}

impl specta::Type for PdfBytes {
    fn definition(_types: &mut Types) -> DataType {
        DataType::Reference(specta_typescript::define("ArrayBuffer"))
    }
}

/// `work`를 blocking 스레드에서 돌린다. 여러 작업이 동시에 돌아도 pdf-core 공개 함수가 pdfium을 쓰는
/// 동안 프로세스 잠금을 잡아 pdfium 호출은 하나씩 실행된다(ADR 0001 §15 "pdfium 잠금").
async fn run_blocking<T, F>(app: AppHandle, work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle) -> Result<T, CommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || work(&app))
        .await
        .map_err(|error| CommandError::TaskFailed {
            detail: error.to_string(),
        })?
        .map_err(AppError::from)
}

fn engine<R: Runtime>(app: &AppHandle<R>) -> Result<State<'_, PdfEngine>, CommandError> {
    app.try_state::<PdfEngine>()
        .ok_or(CommandError::EngineUnavailable)
}

fn path_access<R: Runtime>(app: &AppHandle<R>) -> Result<State<'_, PathAccess>, CommandError> {
    app.try_state::<PathAccess>().ok_or(CommandError::NotReady {
        component: "path access",
    })
}

fn compare_state<R: Runtime>(app: &AppHandle<R>) -> Result<State<'_, CompareState>, CommandError> {
    app.try_state::<CompareState>()
        .ok_or(CommandError::NotReady {
            component: "compare",
        })
}

fn translate_state<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<State<'_, AppTranslateState>, CommandError> {
    app.try_state::<AppTranslateState>()
        .ok_or(CommandError::NotReady {
            component: "translate",
        })
}

/// 번역 커맨드가 쓰는 앱 상태(추출 캐시는 비교와 함께 쓴다)
fn translate_deps<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Deps<'_, ReqwestTransport>, CommandError> {
    Ok(Deps {
        engine: engine(app)?.inner(),
        access: path_access(app)?.inner(),
        extraction: compare_state(app)?.inner().extraction_cache(),
        state: translate_state(app)?.inner(),
    })
}

/// OS 키체인. 서비스 이름은 앱 식별자(번들 ID)다.
fn keychain<R: Runtime>(app: &AppHandle<R>) -> Keychain {
    Keychain::new(&app.config().identifier)
}

fn local_path(file: FilePath) -> Result<PathBuf, CommandError> {
    file.into_path()
        .map_err(|error| CommandError::InvalidDialogPath {
            detail: error.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use specta_typescript::Typescript;

    use super::specta_builder;

    /// 생성 파일이라 저장소의 ESLint·Prettier 규칙으로 고치지 않는다.
    const GENERATED_FILE_HEADER: &str = "/* eslint-disable */";

    /// 커밋하는 TS 바인딩을 다시 만든다. 경계 타입에 JS로 보낼 수 없는 타입(`usize` 등)이
    /// 들어오면 내보내기가 실패한다.
    #[test]
    fn exports_typescript_bindings() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join("renderer")
            .join("shared")
            .join("api")
            .join("bindings.ts");

        specta_builder()
            .export(Typescript::default().header(GENERATED_FILE_HEADER), &path)
            .expect("export TypeScript bindings");
    }
}
