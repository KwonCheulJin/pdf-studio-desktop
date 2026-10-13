//! 비교 요청을 검증해 pdf-core 실행기(`compare_pdfs`, ADR 0001 §15)에 넘긴다.
//!
//! - A·B는 허용 경로 목록(또는 앱 폴더) 안의 PDF만 받는다. canonical 경로로 넘겨 추출 캐시 키가 같은
//!   파일에서 같다.
//! - 추출 메모리 캐시·OCR 디스크 캐시·OCR 엔진은 앱에 하나씩 두고 비교마다 함께 쓴다([`CompareState`]).
//! - OCR 엔진은 첫 비교에서 로드한다. 런타임·모델이 없으면 OCR 없이 비교하고(스캔 쪽은
//!   `NoTextLayer(OcrUnavailable)`), 앱을 다시 시작할 때까지 다시 로드하지 않는다.

use std::error::Error;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Instant;

use pdf_core::{ExtractionCache, OcrCache, OcrEngine, PdfEngine};
use tauri::{App, Manager};

use crate::access::{PDF_EXTENSION, PathAccess};
use crate::contract::{CompareProgress, CompareRequest, CompareResult};
use crate::error::CommandError;
use crate::pdf_engine::bundled_library_dir;

/// OCR 디스크 캐시를 두는 앱 캐시 하위 폴더
const OCR_CACHE_DIRECTORY: &str = "ocr";
/// 번들 리소스 안의 OCR 모델 폴더(`tauri.conf.json`의 `bundle.resources` 대상과 같다)
const OCR_MODEL_DIRECTORY: &str = "ocr-models";

/// 번들한 ONNX Runtime 라이브러리 폴더와 OCR 모델 폴더. 개발·테스트는 pdf-core가
/// `ONNXRUNTIME_LIB_PATH`·`OCR_MODEL_DIR`을 먼저 본다.
#[derive(Debug, Clone)]
pub(crate) struct OcrBundle {
    library_dir: PathBuf,
    model_dir: PathBuf,
}

impl OcrBundle {
    /// macOS는 라이브러리가 pdfium과 같은 `Contents/Frameworks`, 모델은 리소스 폴더 아래다.
    pub(crate) fn of(app: &App) -> Result<Self, Box<dyn Error>> {
        Ok(Self {
            library_dir: bundled_library_dir(app)?,
            model_dir: app.path().resource_dir()?.join(OCR_MODEL_DIRECTORY),
        })
    }
}

enum OcrSlot {
    /// 아직 로드하지 않았다. 첫 비교에서 로드한다.
    NotLoaded(OcrBundle),
    Loaded(Box<OcrEngine>),
    /// 로드하지 못했다(번들 경로를 모르거나 런타임·모델이 없다).
    Unavailable,
}

impl OcrSlot {
    /// 로드한 엔진. 처음 부르면 로드하고, 실패하면 이유를 로그로 남기고 `None`이다.
    fn engine(&mut self) -> Option<&mut OcrEngine> {
        if let Self::NotLoaded(bundle) = self {
            *self = load_ocr(bundle);
        }
        match self {
            Self::Loaded(engine) => Some(engine),
            Self::NotLoaded(_) | Self::Unavailable => None,
        }
    }
}

fn load_ocr(bundle: &OcrBundle) -> OcrSlot {
    let started = Instant::now();
    match OcrEngine::load(&bundle.library_dir, &bundle.model_dir) {
        Ok(engine) => {
            log::info!(
                "OCR engine loaded in {} ms: {} (models {})",
                started.elapsed().as_millis(),
                engine.library_path().display(),
                engine.model_dir().display()
            );
            OcrSlot::Loaded(Box::new(engine))
        }
        Err(error) => {
            log::warn!("OCR is unavailable, scanned pages are compared without OCR: {error}");
            OcrSlot::Unavailable
        }
    }
}

/// 비교마다 함께 쓰는 앱 상태(`app.manage`로 하나)
pub(crate) struct CompareState {
    extraction_cache: ExtractionCache,
    ocr_cache: OcrCache,
    /// `compare_pdfs`가 엔진을 `&mut`로 쓰므로 비교 하나가 끝날 때까지 잡는다.
    ocr: Mutex<OcrSlot>,
}

impl CompareState {
    /// `ocr_bundle`이 없으면(번들 경로를 모른다) OCR 없이 비교한다.
    pub(crate) fn new(ocr_bundle: Option<OcrBundle>, ocr_cache_dir: PathBuf) -> Self {
        Self {
            extraction_cache: ExtractionCache::new(),
            ocr_cache: OcrCache::new(ocr_cache_dir),
            ocr: Mutex::new(ocr_bundle.map_or(OcrSlot::Unavailable, OcrSlot::NotLoaded)),
        }
    }

    /// 앱 캐시 폴더 아래 OCR 디스크 캐시와 번들 OCR 경로로 만든다.
    pub(crate) fn for_app(app: &App) -> Result<Self, Box<dyn Error>> {
        let ocr_cache_dir = app.path().app_cache_dir()?.join(OCR_CACHE_DIRECTORY);
        let ocr_bundle = OcrBundle::of(app)
            .inspect_err(|error| log::error!("OCR bundle directories unavailable: {error}"))
            .ok();
        Ok(Self::new(ocr_bundle, ocr_cache_dir))
    }

    /// 엔진 슬롯은 비교 하나가 통째로 쓴다. 비교 도중 패닉해도 슬롯은 로드 전·후 둘 중 하나라
    /// 잠금 오염은 무시한다.
    fn lock_ocr(&self) -> MutexGuard<'_, OcrSlot> {
        self.ocr.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// 두 PDF를 비교한다. 진행률은 단계·% 가 바뀔 때만 `on_progress`로 온다. 원본은 읽기만 한다.
pub(crate) fn compare(
    engine: &PdfEngine,
    access: &PathAccess,
    state: &CompareState,
    request: &CompareRequest,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(CompareProgress),
) -> Result<CompareResult, CommandError> {
    let core_request = pdf_core::CompareRequest {
        job_id: request.job_id.clone(),
        before: access.readable(&request.before, &[PDF_EXTENSION])?,
        after: access.readable(&request.after, &[PDF_EXTENSION])?,
        options: request.options.clone().into(),
    };
    let mut ocr = state.lock_ocr();
    let result = pdf_core::compare_pdfs(
        engine,
        &core_request,
        ocr.engine(),
        Some(&state.ocr_cache),
        &state.extraction_cache,
        cancel,
        |progress| on_progress(progress.into()),
    )?;
    Ok(result.into())
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::atomic::Ordering;

    use serde_json::json;

    use super::*;
    use crate::contract::{CompareOptions, CompareStage};
    use crate::error::{AppError, ErrorCode};
    use crate::test_support::{TestDir, engine};

    const JOB_ID: &str = "compare-1";

    fn options(range_b: &str) -> CompareOptions {
        CompareOptions {
            range_a: String::new(),
            range_b: range_b.to_owned(),
            exclude_header: false,
            exclude_footer: false,
            exclude_page_numbers: false,
            ignore_case: false,
        }
    }

    fn request(before: &Path, after: &Path, options: CompareOptions) -> CompareRequest {
        CompareRequest {
            job_id: JOB_ID.to_owned(),
            before: before.to_path_buf(),
            after: after.to_path_buf(),
            options,
        }
    }

    /// OCR 없이 비교하는 상태(OCR 엔진을 로드하지 않는다)
    fn state(test_dir: &TestDir) -> CompareState {
        CompareState::new(None, test_dir.user("ocr-cache"))
    }

    struct Run {
        result: Result<CompareResult, CommandError>,
        events: Vec<CompareProgress>,
    }

    fn run(access: &PathAccess, state: &CompareState, request: &CompareRequest) -> Run {
        let mut events = Vec::new();
        let result = compare(
            engine(),
            access,
            state,
            request,
            &AtomicBool::new(false),
            |progress| events.push(progress),
        );
        Run { result, events }
    }

    #[test]
    fn a_file_that_was_not_picked_is_rejected_before_any_stage() {
        let test_dir = TestDir::new("compare-not-picked");
        let access = test_dir.access();
        let before = test_dir.copy_fixture("diff-base.pdf", "before.pdf");
        let after = test_dir.copy_fixture("diff-edit.pdf", "after.pdf");
        access.allow_opened(&before).expect("pick before");

        let run = run(
            &access,
            &state(&test_dir),
            &request(&before, &after, options("")),
        );

        let error = AppError::from(run.result.expect_err("after was not picked"));
        assert_eq!(error.code, ErrorCode::PathNotAllowed);
        assert_eq!(error.path, None);
        assert!(run.events.is_empty());
    }

    /// 쪽 범위 오류는 화면이 어느 쪽 범위인지 알도록 `INVALID_RANGE`이고, 입력 파일 탓이 아니라 경로가 없다.
    #[test]
    fn page_range_beyond_the_document_is_invalid_range_without_a_path() {
        let test_dir = TestDir::new("compare-invalid-range");
        let access = test_dir.access();
        let before = test_dir.copy_fixture("diff-base.pdf", "before.pdf");
        let after = test_dir.copy_fixture("diff-edit.pdf", "after.pdf");
        access.allow_opened(&before).expect("pick before");
        access.allow_opened(&after).expect("pick after");

        let run = run(
            &access,
            &state(&test_dir),
            &request(&before, &after, options("1-25")),
        );

        let error = AppError::from(run.result.expect_err("range is past page 2"));
        assert_eq!(error.code, ErrorCode::InvalidRange);
        assert_eq!(error.path, None);
        assert!(run.events.is_empty());
    }

    #[test]
    fn cancel_job_token_stops_the_comparison_during_extraction() {
        let test_dir = TestDir::new("compare-cancel");
        let access = test_dir.access();
        let before = test_dir.copy_fixture("thirty-pages.pdf", "before.pdf");
        let after = test_dir.copy_fixture("diff-edit.pdf", "after.pdf");
        access.allow_opened(&before).expect("pick before");
        access.allow_opened(&after).expect("pick after");
        let cancel = AtomicBool::new(false);
        let mut stages = Vec::new();

        let error = compare(
            engine(),
            &access,
            &state(&test_dir),
            &request(&before, &after, options("")),
            &cancel,
            |progress| {
                // 사용자가 A 문서를 읽는 도중 "취소"를 누른 것과 같다(`cancel_job`이 이 토큰을 켠다).
                if matches!(progress.stage, CompareStage::ExtractA) && progress.done > 0 {
                    cancel.store(true, Ordering::Relaxed);
                }
                stages.push(progress.stage);
            },
        )
        .expect_err("cancelled");

        assert_eq!(error.code(), ErrorCode::Cancelled);
        assert!(
            stages
                .iter()
                .all(|stage| matches!(stage, CompareStage::ExtractA))
        );
    }

    /// 계약 JSON은 pdf-core 모델의 직렬화(golden·E2E 시드 모양)와 같다. `Notice`·출처는 pdf-core에
    /// 직렬화가 없어 ADR 0001 §7의 모양으로 본다. pages-base ↔ pages-insert는 B에 쪽이 하나 끼었고
    /// 빈 쪽(A 2쪽, B 3쪽)이 OCR 대상인데 OCR이 없다.
    #[test]
    fn contract_json_mirrors_the_pdf_core_result() {
        let test_dir = TestDir::new("compare-contract-json");
        let access = test_dir.access();
        let before = access
            .allow_opened(&test_dir.copy_fixture("pages-base.pdf", "before.pdf"))
            .expect("pick before");
        let after = access
            .allow_opened(&test_dir.copy_fixture("pages-insert.pdf", "after.pdf"))
            .expect("pick after");
        let request = request(&before, &after, options(""));

        let contract = run(&access, &state(&test_dir), &request)
            .result
            .expect("compare");
        let core = pdf_core::compare_pdfs(
            engine(),
            &pdf_core::CompareRequest {
                job_id: JOB_ID.to_owned(),
                before,
                after,
                options: pdf_core::CompareOptions::default(),
            },
            None,
            None,
            &ExtractionCache::new(),
            &AtomicBool::new(false),
            |_| {},
        )
        .expect("compare in pdf-core");

        let json = serde_json::to_value(&contract).expect("serialize contract");
        assert!(!core.changes.is_empty());
        assert_eq!(
            json["changes"],
            serde_json::to_value(&core.changes).expect("serialize changes")
        );
        assert_eq!(
            json["pagePairs"],
            serde_json::to_value(&core.page_pairs).expect("serialize page pairs")
        );
        assert_eq!(
            json["pageSizes"]["after"],
            serde_json::to_value(&core.page_sizes.after).expect("serialize page sizes")
        );
        assert_eq!(json["pageSources"]["before"][0], json!("textLayer"));
        assert_eq!(
            json["notices"],
            json!([
                { "kind": "noTextLayer", "side": "before", "reason": "ocrUnavailable", "pages": [2] },
                { "kind": "noTextLayer", "side": "after", "reason": "ocrUnavailable", "pages": [3] },
            ])
        );
    }
}
