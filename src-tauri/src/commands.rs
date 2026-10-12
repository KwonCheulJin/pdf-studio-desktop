//! Tauri 커맨드. 입력을 받아 처리 함수(`files`, `merge`)에 넘기기만 한다.
//! pdfium·파일 작업은 `spawn_blocking` 스레드에서 돌려 UI 스레드와 async 런타임을 막지 않는다.

use std::path::PathBuf;

use pdf_core::{MAX_INPUT_FILE_BYTES, MAX_MERGE_FILES, PdfEngine};
use specta::Types;
use specta::datatype::DataType;
use tauri::ipc::{Channel, InvokeResponseBody, IpcResponse, Response};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_specta::collect_commands;

use crate::access::{OPENABLE_EXTENSIONS, PDF_EXTENSION, PathAccess};
use crate::contract::{MergeProgress, MergeRequest, MergeResult, OpenedFile, SaveDialogOptions};
use crate::error::{AppError, CommandError};
use crate::jobs::JobRegistry;
use crate::notices::THIRD_PARTY_NOTICES_FILE;
use crate::{files, merge, notices};

/// 열기 다이얼로그의 형식 필터 이름. 언어와 무관한 형식 이름만 쓴다.
const OPENABLE_FILTER_NAME: &str = "PDF, TIFF";
const PDF_FILTER_NAME: &str = "PDF";

/// TS에 내보내는 상수 이름. TS는 이 값을 다시 적지 않고 바인딩에서 가져온다.
const OPENABLE_EXTENSIONS_CONSTANT: &str = "OPENABLE_EXTENSIONS";
const MAX_INPUT_FILE_BYTES_CONSTANT: &str = "MAX_INPUT_FILE_BYTES";
const MAX_MERGE_FILES_CONSTANT: &str = "MAX_MERGE_FILES";

/// JS 숫자로 보내려면 `u32`여야 한다. 상한을 바꿔 넘치면 컴파일이 멈춘다.
const MAX_INPUT_FILE_BYTES_FOR_TS: u32 = {
    assert!(MAX_INPUT_FILE_BYTES <= u32::MAX as u64);
    MAX_INPUT_FILE_BYTES as u32
};
const MAX_MERGE_FILES_FOR_TS: u32 = {
    assert!(MAX_MERGE_FILES <= u32::MAX as usize);
    MAX_MERGE_FILES as u32
};

/// 커맨드·상수를 등록한 tauri-specta 빌더. 앱 실행과 바인딩 생성이 같은 목록을 쓴다.
pub(crate) fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        .commands(collect_commands![
            pick_files,
            pick_save_path,
            open_files,
            read_pdf,
            merge_pdfs,
            cancel_job,
            copy_file,
            discard_temp,
            cleanup_temp,
            read_third_party_notices,
        ])
        .constant(OPENABLE_EXTENSIONS_CONSTANT, OPENABLE_EXTENSIONS)
        .constant(MAX_INPUT_FILE_BYTES_CONSTANT, MAX_INPUT_FILE_BYTES_FOR_TS)
        .constant(MAX_MERGE_FILES_CONSTANT, MAX_MERGE_FILES_FOR_TS)
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

/// `work`를 blocking 스레드에서 돌린다. pdf-core는 `thread_safe` pdfium 바인딩을 쓰므로
/// 여러 스레드에서 불러도 pdfium 호출이 전역 잠금으로 하나씩 실행된다.
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
