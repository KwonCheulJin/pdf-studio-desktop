//! 병합 공개 API 검증. 통합 테스트는 파일마다 별도 프로세스라
//! pdfium 바인딩(프로세스당 한 번)이 다른 테스트 파일과 겹치지 않는다.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use pdf_core::{
    MAX_MERGE_FILES, MergeError, MergePage, MergeProgress, MergeRequest, MergeResult, MergeSource,
    MergeStage, PageBox, PageRotation, PdfEngine, PdfInfo, merge_pdfs, read_pdf_info,
};

const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";
const GEOMETRY_TOLERANCE: f32 = 0.01;
const OUTPUT_FILE: &str = "merged.pdf";

const LETTER_WIDTH: f32 = 612.0;
const LETTER_HEIGHT: f32 = 792.0;
const A4_WIDTH: f32 = 595.0;

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

/// 테스트마다 쓰는 빈 폴더. 테스트가 끝나면(실패해도) 지운다.
struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("pdf-core-merge-{}-{name}", std::process::id()));
        if path.exists() {
            fs::remove_dir_all(&path).expect("clear test dir");
        }
        fs::create_dir_all(&path).expect("create test dir");
        Self { path }
    }

    fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }

    fn output(&self) -> PathBuf {
        self.join(OUTPUT_FILE)
    }

    /// 폴더 안 파일 이름(숨김 파일 포함), 정렬
    fn entries(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.path)
            .expect("read test dir")
            .map(|entry| {
                entry
                    .expect("dir entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        // 정리 실패는 테스트 결과와 무관하다(임시 폴더).
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn page(index: usize, rotation: PageRotation) -> MergePage {
    MergePage { index, rotation }
}

fn upright_pages(indices: &[usize]) -> Vec<MergePage> {
    indices
        .iter()
        .map(|index| page(*index, PageRotation::Degrees0))
        .collect()
}

fn source_at(path: PathBuf, pages: Vec<MergePage>) -> MergeSource {
    MergeSource { path, pages }
}

fn source(name: &str, pages: Vec<MergePage>) -> MergeSource {
    source_at(fixture(name), pages)
}

fn request(sources: Vec<MergeSource>, output_path: PathBuf) -> MergeRequest {
    MergeRequest {
        sources,
        output_path,
    }
}

/// 병합하고 받은 진행률 이벤트를 함께 돌려준다.
fn merge_recording(
    request: &MergeRequest,
) -> (Result<MergeResult, MergeError>, Vec<MergeProgress>) {
    let mut events = Vec::new();
    let result = merge_pdfs(engine(), request, &AtomicBool::new(false), |progress| {
        events.push(progress)
    });
    (result, events)
}

fn merge(request: &MergeRequest) -> Result<MergeResult, MergeError> {
    merge_recording(request).0
}

fn info_at(path: &Path) -> PdfInfo {
    read_pdf_info(engine(), path).expect("read merged pdf")
}

fn assert_close(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() <= GEOMETRY_TOLERANCE,
        "expected {expected}, got {actual}"
    );
}

fn assert_box(actual: PageBox, expected: PageBox) {
    assert_close(actual.left, expected.left);
    assert_close(actual.bottom, expected.bottom);
    assert_close(actual.right, expected.right);
    assert_close(actual.top, expected.top);
}

fn page_box(left: f32, bottom: f32, right: f32, top: f32) -> PageBox {
    PageBox {
        left,
        bottom,
        right,
        top,
    }
}

fn widths(info: &PdfInfo) -> Vec<f32> {
    info.pages.iter().map(|page| page.width_pt).collect()
}

fn assert_widths(info: &PdfInfo, expected: &[f32]) {
    let actual = widths(info);
    assert_eq!(actual.len(), expected.len(), "{actual:?}");
    for (actual, expected) in actual.iter().zip(expected) {
        assert_close(*actual, *expected);
    }
}

fn rotations(info: &PdfInfo) -> Vec<PageRotation> {
    info.pages.iter().map(|page| page.rotation).collect()
}

#[test]
fn merged_pages_add_up_in_source_order() {
    let dir = TestDir::new("source-order");
    let request = request(
        vec![
            source("titled.pdf", upright_pages(&[0, 1, 2, 3, 4])),
            source("three-pages.pdf", upright_pages(&[0, 1, 2])),
            source("one-page.pdf", upright_pages(&[0])),
        ],
        dir.output(),
    );

    let result = merge(&request).expect("merge");

    assert_eq!(result.page_count, 9);
    let info = info_at(&dir.output());
    assert_eq!(info.page_count, 9);
    // Letter 5쪽, A4 3쪽, Letter 1쪽: 소스 순서대로 붙는다.
    assert_widths(
        &info,
        &[
            LETTER_WIDTH,
            LETTER_WIDTH,
            LETTER_WIDTH,
            LETTER_WIDTH,
            LETTER_WIDTH,
            A4_WIDTH,
            A4_WIDTH,
            A4_WIDTH,
            LETTER_WIDTH,
        ],
    );
}
#[test]
fn empty_request_is_rejected() {
    let dir = TestDir::new("empty-request");

    let error = merge(&request(Vec::new(), dir.output())).unwrap_err();

    assert!(matches!(error, MergeError::EmptyRequest), "{error:?}");
    assert_eq!(error.code(), "EMPTY_REQUEST");
    assert!(dir.entries().is_empty());
}

#[test]
fn progress_reports_each_stage_in_order() {
    let dir = TestDir::new("progress");
    let request = request(
        vec![
            source("three-pages.pdf", upright_pages(&[0, 1, 2])),
            source("titled.pdf", upright_pages(&[0, 1, 2, 3, 4])),
            source("one-page.pdf", upright_pages(&[0])),
        ],
        dir.output(),
    );

    let (result, events) = merge_recording(&request);
    result.expect("merge");

    let actual: Vec<(MergeStage, usize, usize, u8, u8)> = events
        .iter()
        .map(|progress| {
            (
                progress.stage,
                progress.done,
                progress.total,
                progress.stage_percent,
                progress.overall_percent,
            )
        })
        .collect();
    // 가중치 20/70/10, 정수 내림. 파일 3개, 페이지 9쪽, 저장 1번.
    let expected = vec![
        (MergeStage::ReadFiles, 0, 3, 0, 0),
        (MergeStage::ReadFiles, 1, 3, 33, 6),
        (MergeStage::ReadFiles, 2, 3, 66, 13),
        (MergeStage::ReadFiles, 3, 3, 100, 20),
        (MergeStage::MergePages, 0, 9, 0, 20),
        (MergeStage::MergePages, 1, 9, 11, 27),
        (MergeStage::MergePages, 2, 9, 22, 35),
        (MergeStage::MergePages, 3, 9, 33, 43),
        (MergeStage::MergePages, 4, 9, 44, 51),
        (MergeStage::MergePages, 5, 9, 55, 58),
        (MergeStage::MergePages, 6, 9, 66, 66),
        (MergeStage::MergePages, 7, 9, 77, 74),
        (MergeStage::MergePages, 8, 9, 88, 82),
        (MergeStage::MergePages, 9, 9, 100, 90),
        (MergeStage::Save, 0, 1, 0, 90),
        (MergeStage::Save, 1, 1, 100, 100),
    ];
    assert_eq!(actual, expected);
}

#[test]
fn missing_output_directory_is_an_error_since_dialog_and_temp_dirs_already_exist() {
    let dir = TestDir::new("missing-output-dir");
    let missing_directory = dir.join("missing");
    let request = request(
        vec![source("one-page.pdf", upright_pages(&[0]))],
        missing_directory.join(OUTPUT_FILE),
    );

    let error = merge(&request).unwrap_err();

    assert_eq!(error.code(), "OUTPUT_DIRECTORY_NOT_FOUND", "{error:?}");
    assert!(!missing_directory.exists(), "output directory was created");
}

#[test]
fn rotation_is_set_as_absolute_value_not_added_to_source_rotation() {
    let dir = TestDir::new("rotation");
    // mixed-geometry 원본 회전: 0쪽 0°, 1쪽 90°, 2쪽 270°
    let request = request(
        vec![source(
            "mixed-geometry.pdf",
            vec![
                page(0, PageRotation::Degrees270),
                page(1, PageRotation::Degrees90),
                page(2, PageRotation::Degrees0),
            ],
        )],
        dir.output(),
    );

    merge(&request).expect("merge");

    let info = info_at(&dir.output());
    assert_eq!(
        rotations(&info),
        vec![
            PageRotation::Degrees270,
            PageRotation::Degrees90,
            PageRotation::Degrees0,
        ]
    );
}

#[test]
fn keeps_requested_page_order_and_rotates_duplicates_independently() {
    let dir = TestDir::new("order");
    // mixed-geometry 4쪽: MediaBox 원점 (100,100), 3쪽: CropBox (50,50,350,450), 0쪽: Letter
    let request = request(
        vec![source(
            "mixed-geometry.pdf",
            vec![
                page(4, PageRotation::Degrees0),
                page(3, PageRotation::Degrees0),
                page(3, PageRotation::Degrees90),
                page(0, PageRotation::Degrees0),
            ],
        )],
        dir.output(),
    );

    let result = merge(&request).expect("merge");

    assert_eq!(result.page_count, 4);
    let info = info_at(&dir.output());
    let letter = page_box(0.0, 0.0, LETTER_WIDTH, LETTER_HEIGHT);
    let cropped = page_box(50.0, 50.0, 350.0, 450.0);
    assert_box(
        info.pages[0].media_box,
        page_box(100.0, 100.0, 400.0, 500.0),
    );
    assert_box(info.pages[1].crop_box, cropped);
    assert_box(info.pages[2].crop_box, cropped);
    assert_box(info.pages[3].media_box, letter);
    assert_box(info.pages[3].crop_box, letter);
    assert_eq!(
        rotations(&info),
        vec![
            PageRotation::Degrees0,
            PageRotation::Degrees0,
            PageRotation::Degrees90,
            PageRotation::Degrees0,
        ]
    );
}

#[test]
fn source_files_keep_their_bytes_and_modified_time() {
    let dir = TestDir::new("sources-untouched");
    let sources: Vec<PathBuf> = ["mixed-geometry.pdf", "three-pages.pdf"]
        .iter()
        .map(|name| {
            let copy = dir.join(name);
            fs::copy(fixture(name), &copy).expect("copy fixture");
            copy
        })
        .collect();
    let snapshot = |path: &PathBuf| {
        let bytes = fs::read(path).expect("read source");
        let modified = fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .expect("source mtime");
        (bytes, modified)
    };
    let before: Vec<_> = sources.iter().map(snapshot).collect();
    let request = request(
        vec![
            source_at(
                sources[0].clone(),
                vec![
                    page(1, PageRotation::Degrees180),
                    page(0, PageRotation::Degrees90),
                ],
            ),
            source_at(sources[1].clone(), vec![page(2, PageRotation::Degrees270)]),
        ],
        dir.output(),
    );

    merge(&request).expect("merge");

    let after: Vec<_> = sources.iter().map(snapshot).collect();
    assert!(before == after, "source files changed");
}

#[test]
fn cancelling_stops_at_the_next_check_and_leaves_no_files() {
    // (취소를 켜는 지점, 단계 안의 done)
    let cancel_points = [
        (MergeStage::ReadFiles, 1),
        (MergeStage::MergePages, 1),
        (MergeStage::Save, 0),
    ];

    for (cancel_stage, cancel_done) in cancel_points {
        let dir = TestDir::new(&format!("cancel-{cancel_stage:?}"));
        let request = request(
            vec![
                source("three-pages.pdf", upright_pages(&[0, 1, 2])),
                source("titled.pdf", upright_pages(&[0, 1, 2, 3, 4])),
            ],
            dir.output(),
        );
        let cancel = AtomicBool::new(false);
        let mut events = Vec::new();

        let result = merge_pdfs(engine(), &request, &cancel, |progress| {
            if progress.stage == cancel_stage && progress.done == cancel_done {
                cancel.store(true, Ordering::Relaxed);
            }
            events.push(progress);
        });

        let error = result.unwrap_err();
        assert!(matches!(error, MergeError::Cancelled), "{error:?}");
        assert_eq!(error.code(), "CANCELLED");
        let last = events.last().expect("progress before cancel");
        assert_eq!(
            (last.stage, last.done),
            (cancel_stage, cancel_done),
            "kept working after cancel"
        );
        assert!(
            dir.entries().is_empty(),
            "left files after cancel at {cancel_stage:?}: {:?}",
            dir.entries()
        );
    }
}

#[test]
fn source_with_bookmarks_is_merged_without_its_bookmarks() {
    const OUTLINES_KEY: &[u8] = b"/Outlines";
    const FIRST_BOOKMARK_TITLE: &[u8] = b"Chapter 1";
    let contains = |haystack: &[u8], needle: &[u8]| {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    };
    let dir = TestDir::new("bookmarks");
    let source_bytes = fs::read(fixture("bookmarked.pdf")).expect("read fixture");
    assert!(contains(&source_bytes, OUTLINES_KEY));
    assert!(contains(&source_bytes, FIRST_BOOKMARK_TITLE));
    let request = request(
        vec![source("bookmarked.pdf", upright_pages(&[0, 1, 2]))],
        dir.output(),
    );

    let result = merge(&request).expect("merge");

    assert_eq!(result.page_count, 3);
    assert_eq!(info_at(&dir.output()).page_count, 3);
    // pdfium의 페이지 가져오기는 페이지 객체만 복사한다: 북마크 트리는 결과에 없다.
    let output_bytes = fs::read(dir.output()).expect("read output");
    assert!(!contains(&output_bytes, OUTLINES_KEY));
    assert!(!contains(&output_bytes, FIRST_BOOKMARK_TITLE));
}

#[test]
fn more_than_max_files_is_rejected_before_reading_any_file() {
    let dir = TestDir::new("too-many-files");
    let sources = (0..=MAX_MERGE_FILES)
        .map(|_| source("one-page.pdf", upright_pages(&[0])))
        .collect();

    let (result, events) = merge_recording(&request(sources, dir.output()));

    let error = result.unwrap_err();
    assert_eq!(error.code(), "TOO_MANY_FILES");
    match error {
        MergeError::TooManyFiles { count, limit } => {
            assert_eq!(count, MAX_MERGE_FILES + 1);
            assert_eq!(limit, MAX_MERGE_FILES);
        }
        other => panic!("expected TooManyFiles, got {other:?}"),
    }
    assert!(events.is_empty(), "started reading: {events:?}");
    assert!(dir.entries().is_empty());
}

#[test]
fn out_of_range_page_is_rejected_with_source_and_index() {
    let dir = TestDir::new("invalid-page");
    let request = request(
        vec![
            source("one-page.pdf", upright_pages(&[0])),
            source("three-pages.pdf", upright_pages(&[0, 3])),
        ],
        dir.output(),
    );

    let (result, events) = merge_recording(&request);

    let error = result.unwrap_err();
    assert_eq!(error.code(), "INVALID_PAGE");
    match error {
        MergeError::InvalidPage {
            source_index,
            page_index,
            page_count,
            path,
        } => {
            assert_eq!((source_index, page_index, page_count), (1, 3, 3));
            assert_eq!(path, fixture("three-pages.pdf"));
        }
        other => panic!("expected InvalidPage, got {other:?}"),
    }
    assert!(
        events
            .iter()
            .all(|progress| progress.stage == MergeStage::ReadFiles),
        "merging started before validation finished: {events:?}"
    );
    assert!(dir.entries().is_empty());
}

#[test]
fn source_without_pages_is_rejected() {
    let dir = TestDir::new("empty-source");
    let request = request(
        vec![
            source("one-page.pdf", upright_pages(&[0])),
            source("three-pages.pdf", Vec::new()),
        ],
        dir.output(),
    );

    let error = merge(&request).unwrap_err();

    match &error {
        MergeError::EmptySource { source_index, path } => {
            assert_eq!(*source_index, 1);
            assert_eq!(path, &fixture("three-pages.pdf"));
        }
        other => panic!("expected EmptySource, got {other:?}"),
    }
    assert_eq!(error.code(), "EMPTY_SOURCE");
    assert!(dir.entries().is_empty());
}

#[test]
fn source_that_cannot_be_opened_is_rejected_with_its_document_error_code() {
    let dir = TestDir::new("protected-source");
    let request = request(
        vec![
            source("one-page.pdf", upright_pages(&[0])),
            source("password-protected.pdf", upright_pages(&[0])),
        ],
        dir.output(),
    );

    let error = merge(&request).unwrap_err();

    assert!(matches!(error, MergeError::Document(_)), "{error:?}");
    assert_eq!(error.code(), "PASSWORD_PROTECTED");
    assert!(dir.entries().is_empty());
}
#[test]
fn existing_output_is_swapped_whole_not_rewritten_in_place() {
    const PREVIOUS_CONTENT: &[u8] = b"previous content";
    const PREVIOUS_LINK: &str = "previous-link.pdf";
    let dir = TestDir::new("replace-output");
    fs::write(dir.output(), PREVIOUS_CONTENT).expect("write previous output");
    // 기존 파일을 가리키는 두 번째 이름. 제자리에 덮어쓰면 이 이름으로 읽은 내용도 바뀐다.
    fs::hard_link(dir.output(), dir.join(PREVIOUS_LINK)).expect("link previous output");
    let request = request(
        vec![source("three-pages.pdf", upright_pages(&[0, 1]))],
        dir.output(),
    );

    merge(&request).expect("merge");

    assert_eq!(info_at(&dir.output()).page_count, 2);
    assert_eq!(
        fs::read(dir.join(PREVIOUS_LINK)).expect("read previous output"),
        PREVIOUS_CONTENT
    );
    assert_eq!(
        dir.entries(),
        vec![OUTPUT_FILE.to_string(), PREVIOUS_LINK.to_string()]
    );
}

#[test]
fn failed_save_removes_the_temp_file() {
    let dir = TestDir::new("save-fails");
    // 출력 경로에 폴더가 있으면 임시 파일을 그 자리로 rename할 수 없다.
    fs::create_dir(dir.output()).expect("create blocking directory");
    let request = request(
        vec![source("one-page.pdf", upright_pages(&[0]))],
        dir.output(),
    );

    let error = merge(&request).unwrap_err();

    assert_eq!(error.code(), "WRITE_FAILED", "{error:?}");
    assert_eq!(dir.entries(), vec![OUTPUT_FILE.to_string()]);
    assert!(dir.output().is_dir());
}
