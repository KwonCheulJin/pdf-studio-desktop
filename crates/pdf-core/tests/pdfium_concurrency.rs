//! pdfium 동시 호출 직렬화 검증(ADR 0001 §15 "pdfium 잠금"). pdfium-render 0.9.4 `thread_safe`는
//! pdfium 함수 467개 중 182개(`FPDFPageObj_SetStrokeColor`·`FPDF_NewXObjectFromPage`·`FPDFText_GetCharBox`·
//! `FPDF_RenderPageBitmapWithMatrix` 등)를 잠금 없이 부른다. 앱은 내보내기·미리보기·비교 추출·병합·
//! 정보 읽기를 서로 다른 작업 스레드에서 동시에 돌리므로, pdf-core 공개 함수가 pdfium을 쓰는 동안
//! 프로세스 잠금을 잡지 않으면 pdfium 공유 상태(색공간 참조 수 등)가 깨져 프로세스가 죽거나 결과가
//! 흔들린다. 통합 테스트는 파일마다 별도 프로세스라 죽어도 다른 테스트 파일에 번지지 않는다.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::AtomicBool;
use std::thread;

use pdf_core::{
    CompareOptions, CompareReportOptions, CompareRequest, CompareResult, ExtractedPage,
    ExtractionCache, PdfEngine, PdfInfo, ReportSources, compare_pdfs, export_annotated_pdf,
    export_compare_pdf, extract_text_layer, preview_compare_report, read_pdf_info,
};

const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";
/// 동시에 도는 작업 스레드 수와 스레드마다 반복 수. 잠금을 뺀 코드에서 30번 중 29번 죽고, 잠금이 있으면
/// debug 빌드로 약 3초 걸리는 크기다(측정은 ADR 0001 §15).
const WORKERS: usize = 12;
const ROUNDS: usize = 20;
/// 작업 종류 수(비교 PDF·주석 PDF·미리보기·추출·정보 읽기). 스레드마다 시작 종류를 어긋나게 둔다.
const WORK_KINDS: usize = 5;
const PREVIEW_SHEETS: u32 = 2;
const PREVIEW_WIDTH_PX: u32 = 480;

fn engine() -> &'static PdfEngine {
    static ENGINE: OnceLock<PdfEngine> = OnceLock::new();
    ENGINE.get_or_init(|| {
        assert!(
            std::env::var_os(LIBRARY_PATH_ENV).is_some(),
            "{LIBRARY_PATH_ENV} is required: run `node scripts/fetch-pdfium.mjs` and export it"
        );
        // 번들 폴더는 없는 경로를 준다: 환경변수 경로로 바인딩돼야 통과한다.
        PdfEngine::bind(Path::new("/nonexistent/pdfium")).expect("bind pdfium")
    })
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

/// 테스트마다 비어 있는 새 폴더. 끝나면(실패해도) 지운다.
struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("pdf-core-{name}-{}", std::process::id()));
        if path.exists() {
            fs::remove_dir_all(&path).expect("clear test dir");
        }
        fs::create_dir_all(&path).expect("create test dir");
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        // 정리 실패는 테스트 결과와 무관하다(임시 폴더).
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// 한 스레드에서 한 번씩 돌린 기준 결과. 동시에 돌린 결과가 이것과 같아야 한다.
struct Baseline {
    sheet_count: u32,
    annotation_count: u32,
    preview: Vec<Vec<u8>>,
    extracted: Vec<ExtractedPage>,
    info: PdfInfo,
}

struct Inputs {
    result: CompareResult,
    sources: ReportSources,
    options: CompareReportOptions,
}

impl Inputs {
    fn export(&self, output: &Path) -> u32 {
        export_compare_pdf(
            engine(),
            &self.result,
            &self.sources,
            &self.options,
            output,
            &AtomicBool::new(false),
        )
        .expect("export compare pdf")
        .sheet_count
    }

    fn annotate(&self, output: &Path) -> u32 {
        export_annotated_pdf(
            engine(),
            &self.result,
            &self.sources.after,
            &self.options.hidden_kinds,
            output,
            &AtomicBool::new(false),
        )
        .expect("export annotated pdf")
        .annotation_count
    }

    fn preview(&self) -> Vec<Vec<u8>> {
        preview_compare_report(
            engine(),
            &self.result,
            &self.sources,
            &self.options,
            PREVIEW_SHEETS,
            PREVIEW_WIDTH_PX,
        )
        .expect("preview")
        .images
    }

    fn extract(&self) -> Vec<ExtractedPage> {
        extract_text_layer(engine(), &self.sources.before).expect("extract")
    }

    fn info(&self) -> PdfInfo {
        read_pdf_info(engine(), &self.sources.after).expect("read info")
    }
}

/// 연결선 픽스처를 비교한 결과를 나란히·색 상자로 내보내는 일(장마다 상자·연결선 색을 칠한다)과
/// 미리보기 렌더·글자 추출·정보 읽기·주석 달기를 여러 스레드가 섞어 돌린다. 프로세스가 끝까지 살아
/// 있고, 모든 결과가 한 스레드에서 돌린 기준과 같다(미리보기 PNG는 바이트까지).
#[test]
fn concurrent_reports_extractions_and_info_reads_match_a_serial_run() {
    let directory = TestDir::new("pdfium-concurrency");
    let before = fixture("connectors-a.pdf");
    let after = fixture("connectors-b.pdf");
    let result = compare_pdfs(
        engine(),
        &CompareRequest {
            job_id: "concurrency".to_owned(),
            before: before.clone(),
            after: after.clone(),
            options: CompareOptions::default(),
        },
        None,
        None,
        &ExtractionCache::new(),
        &AtomicBool::new(false),
        |_| {},
    )
    .expect("compare");
    assert!(!result.changes.is_empty());
    let inputs = Inputs {
        result,
        sources: ReportSources { before, after },
        options: CompareReportOptions::default(),
    };
    let baseline = Baseline {
        sheet_count: inputs.export(&directory.path.join("baseline.pdf")),
        annotation_count: inputs.annotate(&directory.path.join("baseline-annotated.pdf")),
        preview: inputs.preview(),
        extracted: inputs.extract(),
        info: inputs.info(),
    };
    assert!(baseline.annotation_count > 0);

    thread::scope(|scope| {
        for worker in 0..WORKERS {
            let (inputs, baseline, directory) = (&inputs, &baseline, &directory.path);
            scope.spawn(move || {
                for round in 0..ROUNDS {
                    let output = directory.join(format!("{worker}-{round}.pdf"));
                    match (worker + round) % WORK_KINDS {
                        0 => assert_eq!(inputs.export(&output), baseline.sheet_count),
                        1 => assert_eq!(inputs.annotate(&output), baseline.annotation_count),
                        2 => assert!(inputs.preview() == baseline.preview, "preview differs"),
                        3 => assert!(inputs.extract() == baseline.extracted, "text differs"),
                        _ => assert_eq!(inputs.info(), baseline.info),
                    }
                }
            });
        }
    });
}
